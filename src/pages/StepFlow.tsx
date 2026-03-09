import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleHelp, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { PageTransition } from '@/components/shared/PageTransition';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';

type FlowStep = {
  id: string;
  title: string;
  content: string;
  bullets: string[];
  requireConfirm: boolean;
  confirmText: string;
};

type FlowDefinition = {
  title: string;
  subtitle: string;
  steps: FlowStep[];
};

type OntoSynthApplication = {
  id: string;
  name: string;
};

type CreationDocument = {
  name: string;
};

type CreationPhase = {
  id: string;
  title: string;
  interactive: boolean;
  enabledByPipeline: boolean;
  present: boolean;
  supportsRegenerate: boolean;
};

type CreationArtifact = {
  phaseId: string;
  name: string;
  relativePath: string;
  previewType: 'json' | 'text' | 'image' | 'binary';
  editable: boolean;
};

type StructureChapterSummary = {
  id: string;
  title: string;
  startPage: number | null;
  endPage: number | null;
};

type StructureTreeNode = {
  chapterId: string;
  chapterTitle: string;
  sections: Array<{ id: string; title: string }>;
};

type AssessmentCoverageCell = {
  chapterId: string;
  chapterLabel: string;
  questionCount: number;
  fileCount: number;
};

type SlideThumbnailItem = {
  path: string;
  name: string;
  dataUrl: string;
};

type PhaseGuideExtra = {
  structureChapters: StructureChapterSummary[];
  structureTree: StructureTreeNode[];
  knowledgeReady: boolean | null;
  knowledgeBindingReady: boolean | null;
  assessmentCoverage: AssessmentCoverageCell[];
  slideThumbnails: SlideThumbnailItem[];
  slideThumbnailOverflow: number;
};

type GuideTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

type PhaseGuideView = {
  phaseId: string;
  title: string;
  objective: string;
  stats: Array<{ label: string; value: string; tone: GuideTone }>;
  keyFiles: Array<{ path: string; label: string }>;
  actions: string[];
  notes: string[];
  chapters: StructureChapterSummary[];
  structureTree: StructureTreeNode[];
  assessmentCoverage: AssessmentCoverageCell[];
  slideThumbnails: SlideThumbnailItem[];
  slideThumbnailOverflow: number;
};

type RegenerateStatus = {
  status: string;
  message: string;
  runId: string;
  logTail: string;
  mode: 'phase' | 'slide' | '';
};

type WorkflowMode = 'intro' | 'create' | 'edit';
type PipelineTemplate = 'cfa' | 'acca' | 'aec';
type PrimarySourceMode = 'official_textbook' | 'raw_materials' | 'hybrid';
type MaterialBucket = 'official_textbook' | 'raw_materials';

type SelectedMaterialFile = {
  path: string;
  bucket: MaterialBucket;
};

type CreateProgressStatus = 'pending' | 'running' | 'success' | 'error';
type CreateProgressStep = {
  id: 'validate' | 'create' | 'attach' | 'pipeline' | 'finish';
  title: string;
  status: CreateProgressStatus;
  detail: string;
};

type PipelinePhaseStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'not_applicable'
  | 'blocked'
  | 'skipped'
  | 'unsupported';
type PipelinePhase = {
  id: string;
  title: string;
  status: PipelinePhaseStatus;
  reason?: string;
};

type JsonObject = Record<string, unknown>;

const SAMPLE_FLOW_JSON = `{
  "title": "Course Creation Workflow",
  "subtitle": "Review each step and confirm before continuing.",
  "steps": [
    {
      "id": "intake",
      "title": "Step 1 · Intake",
      "content": "Review source documents and confirm input quality.",
      "bullets": [
        "Check file completeness",
        "Confirm source language",
        "Mark critical chapters"
      ],
      "confirmText": "I confirm the intake is ready"
    },
    {
      "id": "structure",
      "title": "Step 2 · Structure Design",
      "content": "Approve the course structure draft before generation.",
      "bullets": [
        "Module hierarchy looks correct",
        "Learning outcomes are explicit"
      ],
      "confirmText": "I confirm the structure plan"
    },
    {
      "id": "publish",
      "title": "Step 3 · Publish Gate",
      "content": "Final review before publishing outputs to the team.",
      "bullets": [
        "Check citations and references",
        "Confirm final artifacts"
      ],
      "confirmText": "I confirm publish approval"
    }
  ]
}`;
const CREATION_FLOW_STORAGE_KEY = 'ontosynth-creation-flow-json-v1';
const CREATION_APP_STORAGE_KEY = 'ontosynth-creation-selected-app-v1';
const LEGACY_FLOW_STORAGE_KEY = 'ontosynth-stepper-flow-json-v1';
const CREATE_PROGRESS_TEMPLATE: ReadonlyArray<Omit<CreateProgressStep, 'status' | 'detail'>> = [
  { id: 'validate', title: 'Validate Input' },
  { id: 'create', title: 'Create Application Scaffold' },
  { id: 'attach', title: 'Attach Materials' },
  { id: 'pipeline', title: 'Run Pipeline' },
  { id: 'finish', title: 'Finalize' },
];
const PIPELINE_PHASE_TEMPLATES: ReadonlyArray<{ id: string; title: string; patterns: RegExp[] }> = [
  { id: '00_textbook', title: 'Textbook Generation', patterns: [/textbook/i, /distill/i, /outline/i] },
  { id: '01_ingestion', title: 'Ingestion', patterns: [/ingestion/i, /phase\s*1/i, /pdf/i] },
  { id: '02_structure', title: 'Structure', patterns: [/structure/i, /extraction/i, /hierarchy/i, /phase\s*2/i] },
  { id: '03_enrichment', title: 'Enrichment', patterns: [/enrichment/i, /phase\s*3/i] },
  { id: '04_knowledge', title: 'Knowledge', patterns: [/ontology/i, /knowledge/i, /phase\s*4/i] },
  { id: '05_mindmap', title: 'Mindmap', patterns: [/mindmap/i, /phase\s*5/i] },
  { id: '06_assessment', title: 'Assessment', patterns: [/assessment/i, /question/i, /phase\s*6/i] },
  { id: '07_slide', title: 'Slide', patterns: [/slide/i, /phase\s*7/i] },
  { id: '08_infographic', title: 'Infographic', patterns: [/infographic/i, /phase\s*8/i] },
  { id: '09_video', title: 'Video', patterns: [/video/i, /phase\s*9/i] },
  { id: '10_learning', title: 'Learning Intelligence', patterns: [/learning/i, /intelligence/i, /phase\s*10/i] },
];

const DEFAULT_GLOBAL_TASK_PARAMS: JsonObject = {
  chapter_parallelism: 2,
  section_parallelism: 4,
  expert_parallelism: 3,
  render_parallelism: 5,
};

const DEFAULT_PHASE_SETTINGS: Record<string, JsonObject> = {
  '00_textbook': {
    preview_chapter_count: 0,
    force_regenerate: false,
    distill_use_llm_summary: true,
    publish_require_all_chapters_pass: true,
    retrieval_require_ready: true,
  },
  '01_ingestion': {
    preferred_engine: 'docling',
    ocr_enabled: true,
    config_path: null,
  },
  '02_structure': {
    structure_char_limit: 150000,
    sub_char_limit: 10000,
    chunk_overlap: 500,
    resume_integrity_check: false,
    resume_integrity_concurrency: 3,
  },
  '03_enrichment': {},
  '04_knowledge': {
    char_limit: 150000,
    chunk_overlap: 500,
    extraction_passes: 1,
    max_workers: 8,
    chunk_limit: 4000,
  },
  '05_mindmap': {
    generate_focus: 'chapter',
    max_depth: 6,
    max_concurrency: 5,
    initial_expand_level: 6,
  },
  '06_assessment': {
    max_batch_size: 10,
    enable_external_search: true,
    question_desc: {
      scq: { generate_count: 10, options_per_question: 3 },
      mcq: { generate_count: 10, options_per_question: 5 },
      fbq: { generate_count: 10, options_per_question: 1 },
    },
  },
  '07_slide': {
    target_pages: 10,
    style_preset: 'academic',
    layout_preset: 'Preset',
    enable_render: true,
    render_retry_attempts: 3,
    render_anchor_retry_attempts: 2,
  },
  '08_infographic': {
    enable_render: true,
    force_regenerate: false,
    max_slides_per_infographic: 9,
    target_width: 1600,
  },
  '09_video': {
    enable_render: true,
    language: 'en',
    tone: 'professional pedagogical',
  },
  '10_learning': {
    study_plan_horizon_days: 14,
    mastery_threshold: 0.9,
    readiness_gate_enabled: true,
  },
};

function flowStorageKey(applicationId: string): string {
  return `${CREATION_FLOW_STORAGE_KEY}:${applicationId || 'default'}`;
}

function readInitialSelectedApplicationId(): string {
  if (typeof window === 'undefined') return 'default';
  try {
    const saved = window.localStorage.getItem(CREATION_APP_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // Ignore storage read errors and fall back to default.
  }
  return 'default';
}

function readSavedFlowJson(applicationId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(flowStorageKey(applicationId));
    if (saved && saved.trim()) return saved;
    if (!applicationId || applicationId === 'default') {
      const legacy = window.localStorage.getItem(LEGACY_FLOW_STORAGE_KEY);
      if (legacy && legacy.trim()) return legacy;
    }
  } catch {
    // Ignore storage read errors and return null.
  }
  return null;
}

function readInitialRawJson(applicationId: string): string {
  const saved = readSavedFlowJson(applicationId);
  if (saved) return saved;
  return SAMPLE_FLOW_JSON;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function pickBoolean(record: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) continue;
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
  }
  return fallback;
}

function parseOntoSynthApplications(payload: unknown): OntoSynthApplication[] {
  const record = asRecord(payload);
  if (!record) return [];
  const rawApplications = Array.isArray(record.applications) ? record.applications : [];
  return rawApplications
    .map((item) => {
      const app = asRecord(item);
      if (!app) return null;
      const id = pickString(app, ['id']);
      const name = pickString(app, ['name']) || id;
      if (!id) return null;
      return { id, name } satisfies OntoSynthApplication;
    })
    .filter((item): item is OntoSynthApplication => !!item);
}

function parseCreationDocuments(payload: unknown): CreationDocument[] {
  const record = asRecord(payload);
  if (!record) return [];
  const rawDocuments = Array.isArray(record.documents) ? record.documents : [];
  return rawDocuments
    .map((item) => {
      const doc = asRecord(item);
      if (!doc) return null;
      const name = pickString(doc, ['name']);
      if (!name) return null;
      return { name } satisfies CreationDocument;
    })
    .filter((item): item is CreationDocument => !!item);
}

function parseCreationPhases(payload: unknown): CreationPhase[] {
  const record = asRecord(payload);
  if (!record) return [];
  const rawPhases = Array.isArray(record.phases) ? record.phases : [];
  return rawPhases
    .map((item) => {
      const phase = asRecord(item);
      if (!phase) return null;
      const id = pickString(phase, ['id']);
      if (!id) return null;
      const title = pickString(phase, ['title']) || id;
      const interactive = pickBoolean(phase, ['interactive'], false);
      const enabledByPipeline = pickBoolean(phase, ['enabled_by_pipeline', 'enabledByPipeline'], false);
      const present = pickBoolean(phase, ['present'], false);
      const supportsRegenerate = pickBoolean(phase, ['supports_regenerate', 'supportsRegenerate'], false);
      return {
        id,
        title,
        interactive,
        enabledByPipeline,
        present,
        supportsRegenerate,
      } satisfies CreationPhase;
    })
    .filter((item): item is CreationPhase => !!item);
}

function parseCreationArtifacts(payload: unknown): CreationArtifact[] {
  const record = asRecord(payload);
  if (!record) return [];
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  return rawArtifacts
    .map((item) => {
      const artifact = asRecord(item);
      if (!artifact) return null;
      const relativePath = pickString(artifact, ['relative_path', 'relativePath']);
      if (!relativePath) return null;
      const name = pickString(artifact, ['name']) || relativePath.split('/').pop() || relativePath;
      const phaseId = pickString(artifact, ['phase_id', 'phaseId']) || 'unknown';
      const preview = pickString(artifact, ['preview_type', 'previewType']).toLowerCase();
      const previewType: CreationArtifact['previewType'] =
        preview === 'json' || preview === 'text' || preview === 'image' ? preview : 'binary';
      return {
        phaseId,
        name,
        relativePath,
        previewType,
        editable: pickBoolean(artifact, ['editable'], false),
      } satisfies CreationArtifact;
    })
    .filter((item): item is CreationArtifact => !!item);
}

function parsePipelineRuntimePhases(payload: unknown): PipelinePhase[] {
  const record = asRecord(payload);
  const runtime = asRecord(record?.phase_runtime);
  const rows = Array.isArray(runtime?.phases) ? runtime?.phases : [];
  const statuses = new Set<PipelinePhaseStatus>([
    'pending',
    'running',
    'success',
    'error',
    'not_applicable',
    'blocked',
    'skipped',
    'unsupported',
  ]);
  return rows
    .map((item) => {
      const phase = asRecord(item);
      if (!phase) return null;
      const id = pickString(phase, ['id']);
      if (!id) return null;
      const title = pickString(phase, ['title']) || id;
      const rawStatus = pickString(phase, ['status']).toLowerCase();
      const normalizedStatus = rawStatus === 'failed' ? 'error' : rawStatus;
      const status: PipelinePhaseStatus = statuses.has(normalizedStatus as PipelinePhaseStatus)
        ? (normalizedStatus as PipelinePhaseStatus)
        : 'pending';
      const reason = pickString(phase, ['reason']);
      const result: PipelinePhase = reason
        ? { id, title, status, reason }
        : { id, title, status };
      return result;
    })
    .filter((item): item is PipelinePhase => item !== null);
}

function phaseStatusDotClass(status: PipelinePhaseStatus): string {
  if (status === 'success') return 'bg-aegis-success';
  if (status === 'running') return 'bg-aegis-primary';
  if (status === 'error' || status === 'blocked') return 'bg-aegis-danger';
  if (status === 'skipped' || status === 'unsupported' || status === 'not_applicable') return 'bg-aegis-border';
  return 'bg-aegis-text-dim';
}

function phaseStatusTextClass(status: PipelinePhaseStatus): string {
  if (status === 'success') return 'text-aegis-success';
  if (status === 'running') return 'text-aegis-primary';
  if (status === 'error' || status === 'blocked') return 'text-aegis-danger';
  if (status === 'skipped' || status === 'unsupported' || status === 'not_applicable') return 'text-aegis-text-dim';
  return 'text-aegis-text-dim';
}

function formatPhaseStatus(status: PipelinePhaseStatus): string {
  return status.replace(/_/g, ' ');
}

function flowFromPhases(applicationName: string, phases: CreationPhase[]): FlowDefinition {
  const steps: FlowStep[] = phases
    .filter((phase) => phase.enabledByPipeline || phase.present)
    .map((phase, index) => ({
      id: phase.id,
      title: `Step ${index + 1} · ${phase.title}`,
      content: `${phase.title} phase for ${applicationName}. Review generated artifacts and confirm before continuing.`,
      bullets: [
        phase.present ? 'Existing outputs detected' : 'Outputs not generated yet',
        phase.interactive ? 'Human review recommended' : 'System-run phase',
        phase.supportsRegenerate ? 'Regeneration API available' : 'Regeneration API not enabled',
      ],
      requireConfirm: false,
      confirmText: '',
    }));

  if (steps.length === 0) {
    return {
      title: 'Course Creation Workflow',
      subtitle: 'No backend phases detected. You can still load custom JSON.',
      steps: [
        {
          id: 'fallback',
          title: 'Step 1 · Setup',
          content: 'No active phases were detected for this application.',
          bullets: ['Verify application output path', 'Run pipeline once to generate phase outputs'],
          requireConfirm: false,
          confirmText: '',
        },
      ],
    };
  }

  return {
    title: 'Course Creation Workflow',
    subtitle: 'Backend phase profile loaded from OntoSynth output.',
    steps,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error) return error.message;
  return fallback;
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function toApplicationId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function fileNameFromPath(filePath: string): string {
  const normalized = String(filePath || '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function deriveSourceModeFromMaterials(officialCount: number, rawCount: number): PrimarySourceMode {
  if (officialCount > 0 && rawCount > 0) return 'hybrid';
  if (officialCount > 0) return 'official_textbook';
  return 'raw_materials';
}

function newCreateProgressSteps(): CreateProgressStep[] {
  return CREATE_PROGRESS_TEMPLATE.map((item) => ({
    ...item,
    status: 'pending',
    detail: '',
  }));
}

function updateCreateProgressStep(
  steps: CreateProgressStep[],
  stepId: CreateProgressStep['id'],
  status: CreateProgressStatus,
  detail: string,
): CreateProgressStep[] {
  return steps.map((step) => (step.id === stepId ? { ...step, status, detail } : step));
}

function newPipelinePhases(): PipelinePhase[] {
  return PIPELINE_PHASE_TEMPLATES.map((phase) => ({
    id: phase.id,
    title: phase.title,
    status: 'pending',
  }));
}

function newCreatePhaseSelection(): Record<string, boolean> {
  return {
    '00_textbook': false,
    '01_ingestion': true,
    '02_structure': true,
    '03_enrichment': false,
    '04_knowledge': true,
    '05_mindmap': true,
    '06_assessment': true,
    '07_slide': true,
    '08_infographic': true,
    '09_video': false,
    '10_learning': true,
  };
}

function detectPipelinePhaseIdsFromLog(logTail: string): string[] {
  const text = String(logTail || '');
  if (!text) return [];
  const matched: string[] = [];
  for (const phase of PIPELINE_PHASE_TEMPLATES) {
    if (phase.patterns.some((pattern) => pattern.test(text))) {
      matched.push(phase.id);
    }
  }
  return matched;
}

function applyPipelinePhaseStatuses(
  phases: PipelinePhase[],
  seenIds: Set<string>,
  currentId: string,
  runStatus: string,
): PipelinePhase[] {
  return phases.map((phase) => {
    if (runStatus === 'error' || runStatus === 'cancelled') {
      if (phase.id === currentId) return { ...phase, status: 'error' };
      if (seenIds.has(phase.id)) return { ...phase, status: 'success' };
      return { ...phase, status: 'pending' };
    }
    if (runStatus === 'success') {
      if (seenIds.has(phase.id)) return { ...phase, status: 'success' };
      return { ...phase, status: 'pending' };
    }
    if (phase.id === currentId) return { ...phase, status: 'running' };
    if (seenIds.has(phase.id)) return { ...phase, status: 'success' };
    return { ...phase, status: 'pending' };
  });
}

function normalizeStepRunStatus(record: Record<string, unknown> | null): string {
  if (!record) return 'running';
  const raw = pickString(record, ['run_status', 'runStatus', 'status']).toLowerCase();
  if (!raw) return 'running';
  if (raw === 'failed') return 'error';
  if (raw === 'ok') return 'running';
  return raw;
}

function isStepRunActive(status: string): boolean {
  const value = String(status || '').toLowerCase();
  return value === 'running' || value === 'busy' || value === 'ok';
}

function findNestedStringByKey(value: unknown, keys: Set<string>, depth = 0): string {
  if (depth > 8 || value == null) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedStringByKey(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (keys.has(key.toLowerCase())) {
      const str = nonEmptyString(item);
      if (str) return str;
    }
    const nested = findNestedStringByKey(item, keys, depth + 1);
    if (nested) return nested;
  }
  return '';
}

function parseSlideIdentifiersFromJson(content: string): {
  docId: string;
  chapterId: string;
  sectionId: string;
  slideId: string;
} {
  try {
    const parsed = JSON.parse(content);
    return {
      docId: findNestedStringByKey(parsed, new Set(['doc_id', 'docid', 'document_id', 'documentid'])),
      chapterId: findNestedStringByKey(parsed, new Set(['chapter_id', 'chapterid'])),
      sectionId: findNestedStringByKey(parsed, new Set(['section_id', 'sectionid'])),
      slideId: findNestedStringByKey(parsed, new Set(['slide_id', 'slideid'])),
    };
  } catch {
    return { docId: '', chapterId: '', sectionId: '', slideId: '' };
  }
}

function safeParseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toneClass(tone: GuideTone): string {
  if (tone === 'success') return 'border-aegis-success/25 bg-aegis-success/[0.08] text-aegis-success';
  if (tone === 'warning') return 'border-aegis-warning/25 bg-aegis-warning/[0.08] text-aegis-warning';
  if (tone === 'danger') return 'border-aegis-danger/25 bg-aegis-danger/[0.08] text-aegis-danger';
  if (tone === 'accent') return 'border-aegis-accent/25 bg-aegis-accent/[0.08] text-aegis-accent';
  return 'border-aegis-border bg-aegis-card text-aegis-text-dim';
}

function emptyPhaseGuideExtra(): PhaseGuideExtra {
  return {
    structureChapters: [],
    structureTree: [],
    knowledgeReady: null,
    knowledgeBindingReady: null,
    assessmentCoverage: [],
    slideThumbnails: [],
    slideThumbnailOverflow: 0,
  };
}

function normalizeStep(raw: unknown, index: number): FlowStep | null {
  const fallbackTitle = `Step ${index + 1}`;
  if (typeof raw === 'string') {
    const content = raw.trim();
    if (!content) return null;
    return {
      id: `step-${index + 1}`,
      title: fallbackTitle,
      content,
      bullets: [],
      requireConfirm: false,
      confirmText: '',
    };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const step = raw as Record<string, unknown>;
  const title = nonEmptyString(step.title) || nonEmptyString(step.name) || fallbackTitle;
  const content =
    nonEmptyString(step.content) ||
    nonEmptyString(step.description) ||
    nonEmptyString(step.text) ||
    nonEmptyString(step.body);

  if (!content) return null;

  const bulletsRaw = Array.isArray(step.bullets)
    ? step.bullets
    : Array.isArray(step.checklist)
      ? step.checklist
      : [];
  const bullets = bulletsRaw
    .map((item) => nonEmptyString(item))
    .filter((item) => item.length > 0);

  const id = nonEmptyString(step.id) || `step-${index + 1}`;
  const requireConfirm = step.requireConfirm === true;
  const confirmText = requireConfirm ? (nonEmptyString(step.confirmText) || 'I confirm this step') : '';

  return {
    id,
    title,
    content,
    bullets,
    requireConfirm,
    confirmText,
  };
}

function parseFlowJson(rawJson: string): FlowDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON format.');
  }

  const container = parsed as Record<string, unknown>;
  const stepsRaw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container.steps)
      ? container.steps
      : null;

  if (!stepsRaw) {
    throw new Error('JSON must be an array of steps or an object with a "steps" array.');
  }

  const steps = stepsRaw
    .map((step, index) => normalizeStep(step, index))
    .filter((step): step is FlowStep => !!step);

  if (steps.length === 0) {
    throw new Error('No valid steps found. Each step needs at least title/content.');
  }

  return {
    title: nonEmptyString(container.title) || nonEmptyString(container.name) || 'Marquee Step Flow',
    subtitle: nonEmptyString(container.subtitle) || nonEmptyString(container.description) || 'One-step-per-page guided confirmation flow.',
    steps,
  };
}

function buildInitialPhaseSettingsRawById(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const phase of PIPELINE_PHASE_TEMPLATES) {
    const preset = DEFAULT_PHASE_SETTINGS[phase.id] || {};
    out[phase.id] = JSON.stringify(preset, null, 2);
  }
  return out;
}

function parseJsonObject(raw: string): JsonObject {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object');
  }
  return parsed as JsonObject;
}

export function StepFlowPage() {
  const connected = useChatStore((state) => state.connected);
  const profileRequestRef = useRef(0);
  const artifactsRequestRef = useRef(0);
  const artifactReadRequestRef = useRef(0);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('intro');
  const [newApplicationName, setNewApplicationName] = useState('');
  const [newApplicationId, setNewApplicationId] = useState('');
  const [pipelineTemplate, setPipelineTemplate] = useState<PipelineTemplate>('cfa');
  const [applicationVersion, setApplicationVersion] = useState('v2026');
  const [createPhaseSelection, setCreatePhaseSelection] = useState<Record<string, boolean>>(() => newCreatePhaseSelection());
  const [modelPolicyPreset, setModelPolicyPreset] = useState('balanced');
  const [knowledgeSchemaPreset, setKnowledgeSchemaPreset] = useState('standard_esg');
  const [createGlobalTaskParamsRaw, setCreateGlobalTaskParamsRaw] = useState(
    () => JSON.stringify(DEFAULT_GLOBAL_TASK_PARAMS, null, 2),
  );
  const [createGlobalTaskParamsError, setCreateGlobalTaskParamsError] = useState('');
  const [createPhaseSettingsRawById, setCreatePhaseSettingsRawById] = useState<Record<string, string>>(
    () => buildInitialPhaseSettingsRawById(),
  );
  const [createPhaseSettingsErrorById, setCreatePhaseSettingsErrorById] = useState<Record<string, string>>({});
  const [activeCreatePhaseSettingsId, setActiveCreatePhaseSettingsId] = useState('01_ingestion');
  const [createdApplicationId, setCreatedApplicationId] = useState('');
  const [createStatus, setCreateStatus] = useState('');
  const [createError, setCreateError] = useState('');
  const [creatingApplication, setCreatingApplication] = useState(false);
  const [createProgressMessage, setCreateProgressMessage] = useState('Ready to create.');
  const [createProgressSteps, setCreateProgressSteps] = useState<CreateProgressStep[]>(() => newCreateProgressSteps());
  const [createProgressUpdatedAt, setCreateProgressUpdatedAt] = useState<number | null>(null);
  const [createPipelineRunId, setCreatePipelineRunId] = useState('');
  const [createPipelineStatus, setCreatePipelineStatus] = useState<'idle' | 'running' | 'success' | 'error' | 'cancelled'>('idle');
  const [createPipelineMessage, setCreatePipelineMessage] = useState('');
  const [createPipelineLogTail, setCreatePipelineLogTail] = useState('');
  const [createPipelineApplicationId, setCreatePipelineApplicationId] = useState('');
  const [createPipelineCurrentPhaseId, setCreatePipelineCurrentPhaseId] = useState('');
  const [createPipelineSeenPhaseIds, setCreatePipelineSeenPhaseIds] = useState<string[]>([]);
  const [createPipelinePhases, setCreatePipelinePhases] = useState<PipelinePhase[]>(() => newPipelinePhases());
  const [pinnedPhaseReasonId, setPinnedPhaseReasonId] = useState('');
  const [createPipelineDebugText, setCreatePipelineDebugText] = useState('');
  const [createPipelinePollCount, setCreatePipelinePollCount] = useState(0);
  const [createPipelineLastError, setCreatePipelineLastError] = useState('');
  const [copyLogStatus, setCopyLogStatus] = useState('');
  const [copyDebugStatus, setCopyDebugStatus] = useState('');
  const [stepPollCount, setStepPollCount] = useState(0);
  const [stepLastUpdateAt, setStepLastUpdateAt] = useState<number | null>(null);
  const [stepLastPollError, setStepLastPollError] = useState('');
  const [stepLogCopyStatus, setStepLogCopyStatus] = useState('');
  const [selectedMaterialFiles, setSelectedMaterialFiles] = useState<SelectedMaterialFile[]>([]);
  const [materialsStatus, setMaterialsStatus] = useState('');
  const [materialsError, setMaterialsError] = useState('');
  const [applications, setApplications] = useState<OntoSynthApplication[]>([]);
  const [documents, setDocuments] = useState<CreationDocument[]>([]);
  const [phases, setPhases] = useState<CreationPhase[]>([]);
  const [artifacts, setArtifacts] = useState<CreationArtifact[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [artifactReadLoading, setArtifactReadLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState('');
  const [artifactsError, setArtifactsError] = useState('');
  const [selectedApplicationId, setSelectedApplicationId] = useState(() => readInitialSelectedApplicationId());
  const [selectedDocumentName, setSelectedDocumentName] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [selectedArtifactPath, setSelectedArtifactPath] = useState('');
  const selectedApplicationIdRef = useRef(selectedApplicationId);
  const selectedDocumentNameRef = useRef(selectedDocumentName);
  const selectedPhaseIdRef = useRef(selectedPhaseId);
  const selectedArtifactPathRef = useRef(selectedArtifactPath);
  const [artifactKind, setArtifactKind] = useState<'json' | 'text' | 'image' | 'binary' | ''>('');
  const [artifactMime, setArtifactMime] = useState('');
  const [artifactText, setArtifactText] = useState('');
  const [artifactDataUrl, setArtifactDataUrl] = useState('');
  const [artifactDirty, setArtifactDirty] = useState(false);
  const [artifactStatus, setArtifactStatus] = useState('');
  const [slideDocId, setSlideDocId] = useState('');
  const [slideChapterId, setSlideChapterId] = useState('');
  const [slideSectionId, setSlideSectionId] = useState('');
  const [slideItemId, setSlideItemId] = useState('');
  const [slideRevisionNote, setSlideRevisionNote] = useState('');
  const [phaseGuideLoading, setPhaseGuideLoading] = useState(false);
  const [phaseGuideError, setPhaseGuideError] = useState('');
  const [phaseGuideExtra, setPhaseGuideExtra] = useState<PhaseGuideExtra>(() => emptyPhaseGuideExtra());
  const [regenStatus, setRegenStatus] = useState<RegenerateStatus>({
    status: 'idle',
    message: '',
    runId: '',
    logTail: '',
    mode: '',
  });
  const [rawJson, setRawJson] = useState(() => {
    const initialRawJson = readInitialRawJson(readInitialSelectedApplicationId());
    try {
      parseFlowJson(initialRawJson);
      return initialRawJson;
    } catch {
      return SAMPLE_FLOW_JSON;
    }
  });
  const [flow, setFlow] = useState<FlowDefinition>(() => {
    const initialRawJson = readInitialRawJson(readInitialSelectedApplicationId());
    try {
      return parseFlowJson(initialRawJson);
    } catch {
      return parseFlowJson(SAMPLE_FLOW_JSON);
    }
  });
  const [jsonError, setJsonError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [confirmByStepId, setConfirmByStepId] = useState<Record<string, boolean>>({});
  const selectedApplicationName = useMemo(() => {
    if (!selectedApplicationId || selectedApplicationId === 'default') return 'Default';
    return applications.find((item) => item.id === selectedApplicationId)?.name || selectedApplicationId;
  }, [applications, selectedApplicationId]);
  const selectedPhase = useMemo(
    () => phases.find((item) => item.id === selectedPhaseId) || null,
    [phases, selectedPhaseId],
  );
  const selectedArtifact = useMemo(
    () => artifacts.find((item) => item.relativePath === selectedArtifactPath) || null,
    [artifacts, selectedArtifactPath],
  );
  const officialMaterialPaths = useMemo(
    () =>
      selectedMaterialFiles
        .filter((item) => item.bucket === 'official_textbook')
        .map((item) => item.path),
    [selectedMaterialFiles],
  );
  const rawMaterialPaths = useMemo(
    () =>
      selectedMaterialFiles
        .filter((item) => item.bucket === 'raw_materials')
        .map((item) => item.path),
    [selectedMaterialFiles],
  );
  const sourceMode = useMemo(
    () => deriveSourceModeFromMaterials(officialMaterialPaths.length, rawMaterialPaths.length),
    [officialMaterialPaths.length, rawMaterialPaths.length],
  );
  const sourceFilename = useMemo(() => {
    const preferred = officialMaterialPaths[0] || rawMaterialPaths[0] || '';
    return preferred ? fileNameFromPath(preferred) : '';
  }, [officialMaterialPaths, rawMaterialPaths]);
  const officialMaterialItems = useMemo(
    () => selectedMaterialFiles.filter((item) => item.bucket === 'official_textbook'),
    [selectedMaterialFiles],
  );
  const rawMaterialItems = useMemo(
    () => selectedMaterialFiles.filter((item) => item.bucket === 'raw_materials'),
    [selectedMaterialFiles],
  );
  const createEnabledPhaseIds = useMemo(() => {
    const selected = PIPELINE_PHASE_TEMPLATES
      .map((phase) => phase.id)
      .filter((id) => !!createPhaseSelection[id]);
    if (rawMaterialPaths.length === 0) {
      return selected.filter((id) => id !== '00_textbook');
    }
    return selected;
  }, [createPhaseSelection, rawMaterialPaths.length]);
  const createProgressDoneCount = useMemo(
    () => createProgressSteps.filter((step) => step.status === 'success').length,
    [createProgressSteps],
  );
  const createPipelineRunning = createPipelineStatus === 'running';
  const stepRunActive = isStepRunActive(regenStatus.status);
  const slideActionEnabled =
    selectedPhaseId === '07_slide' &&
    !!selectedApplicationId &&
    selectedApplicationId !== 'default' &&
    !!slideDocId.trim() &&
    !!slideChapterId.trim() &&
    !!slideSectionId.trim() &&
    !!slideItemId.trim();
  const createPipelineCurrentPhaseTitle = useMemo(
    () => createPipelinePhases.find((item) => item.id === createPipelineCurrentPhaseId)?.title || '',
    [createPipelineCurrentPhaseId, createPipelinePhases],
  );
  const activeCreatePhaseSettingsRaw = useMemo(
    () => createPhaseSettingsRawById[activeCreatePhaseSettingsId] || '{}',
    [activeCreatePhaseSettingsId, createPhaseSettingsRawById],
  );
  const activeCreatePhaseSettingsError = useMemo(
    () => createPhaseSettingsErrorById[activeCreatePhaseSettingsId] || '',
    [createPhaseSettingsErrorById, activeCreatePhaseSettingsId],
  );

  useEffect(() => {
    selectedApplicationIdRef.current = selectedApplicationId;
  }, [selectedApplicationId]);

  useEffect(() => {
    selectedDocumentNameRef.current = selectedDocumentName;
  }, [selectedDocumentName]);

  useEffect(() => {
    selectedPhaseIdRef.current = selectedPhaseId;
  }, [selectedPhaseId]);

  useEffect(() => {
    selectedArtifactPathRef.current = selectedArtifactPath;
  }, [selectedArtifactPath]);

  useEffect(() => {
    if (!pinnedPhaseReasonId) return;
    const stillVisible = createPipelinePhases.some(
      (phase) => phase.id === pinnedPhaseReasonId && !!phase.reason,
    );
    if (!stillVisible) setPinnedPhaseReasonId('');
  }, [createPipelinePhases, pinnedPhaseReasonId]);

  useEffect(() => {
    if (PIPELINE_PHASE_TEMPLATES.length === 0) {
      setActiveCreatePhaseSettingsId('');
      return;
    }
    if (!activeCreatePhaseSettingsId || !PIPELINE_PHASE_TEMPLATES.some((phase) => phase.id === activeCreatePhaseSettingsId)) {
      setActiveCreatePhaseSettingsId(PIPELINE_PHASE_TEMPLATES[0]?.id || '');
    }
  }, [activeCreatePhaseSettingsId]);

  const copyPipelineSection = useCallback(async (content: string, target: 'log' | 'debug') => {
    const text = String(content || '').trim();
    if (!text) {
      if (target === 'log') setCopyLogStatus('No log content to copy.');
      else setCopyDebugStatus('No debug content to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (target === 'log') {
        setCopyLogStatus('Copied.');
      } else {
        setCopyDebugStatus('Copied.');
      }
      window.setTimeout(() => {
        if (target === 'log') setCopyLogStatus('');
        else setCopyDebugStatus('');
      }, 1800);
    } catch {
      if (target === 'log') setCopyLogStatus('Copy failed.');
      else setCopyDebugStatus('Copy failed.');
    }
  }, []);

  const copyStepLogs = useCallback(async () => {
    const text = String(regenStatus.logTail || '').trim();
    if (!text) {
      setStepLogCopyStatus('No log content to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStepLogCopyStatus('Copied.');
      window.setTimeout(() => setStepLogCopyStatus(''), 1800);
    } catch {
      setStepLogCopyStatus('Copy failed.');
    }
  }, [regenStatus.logTail]);

  useEffect(() => {
    setCreatePhaseSelection((prev) => {
      const textbookEnabled = !!prev['00_textbook'];
      if (rawMaterialPaths.length === 0 && textbookEnabled) {
        return { ...prev, '00_textbook': false };
      }
      if (rawMaterialPaths.length > 0 && !textbookEnabled) {
        return { ...prev, '00_textbook': true };
      }
      return prev;
    });
  }, [rawMaterialPaths.length]);

  const currentStep = flow.steps[Math.min(currentStepIndex, flow.steps.length - 1)];
  const currentConfirmed = currentStep ? !!confirmByStepId[currentStep.id] : false;
  const needsConfirm = currentStep?.requireConfirm ?? false;
  const continueDisabled = completed || (needsConfirm && !currentConfirmed);
  const guidePhaseId = useMemo(() => {
    const stepId = currentStep?.id || '';
    if (stepId && phases.some((phase) => phase.id === stepId)) return stepId;
    return selectedPhaseId;
  }, [currentStep?.id, phases, selectedPhaseId]);
  const guidePhase = useMemo(
    () => phases.find((phase) => phase.id === guidePhaseId) || null,
    [guidePhaseId, phases],
  );
  const phaseGuide = useMemo<PhaseGuideView | null>(() => {
    if (!guidePhaseId) return null;
    const files = artifacts.filter((artifact) => artifact.phaseId === guidePhaseId);
    const relativePaths = files.map((artifact) => artifact.relativePath);
    const findPath = (needle: string): string =>
      relativePaths.find((path) => path.toLowerCase().endsWith(needle.toLowerCase())) || '';
    const count = (pattern: RegExp): number => relativePaths.filter((path) => pattern.test(path)).length;

    const base: PhaseGuideView = {
      phaseId: guidePhaseId,
      title: guidePhase?.title || guidePhaseId,
      objective: 'Review output quality, then run or regenerate this phase as needed.',
      stats: [
        { label: 'Files', value: String(files.length), tone: files.length > 0 ? 'success' : 'warning' },
        {
          label: 'Pipeline',
          value: guidePhase?.enabledByPipeline ? 'Enabled' : 'Optional',
          tone: guidePhase?.enabledByPipeline ? 'accent' : 'neutral',
        },
      ],
      keyFiles: files.slice(0, 4).map((item) => ({ path: item.relativePath, label: item.name })),
      actions: ['Run Phase', 'Refresh Files', 'Open key output files and validate structure'],
      notes: files.length > 0 ? ['Outputs detected for this phase.'] : ['No outputs detected yet for this phase.'],
      chapters: [],
      structureTree: [],
      assessmentCoverage: [],
      slideThumbnails: [],
      slideThumbnailOverflow: 0,
    };

    if (guidePhaseId === '00_textbook') {
      return {
        ...base,
        objective: 'Generate textbook-grade source from raw materials before ingestion.',
        stats: [
          { label: 'Files', value: String(files.length), tone: files.length > 0 ? 'success' : 'warning' },
          {
            label: 'Status',
            value: files.length > 0 ? 'Generated' : 'Not generated',
            tone: files.length > 0 ? 'success' : 'warning',
          },
        ],
        actions: ['Run Phase when Raw Materials are provided', 'Review distilled textbook quality'],
      };
    }

    if (guidePhaseId === '01_ingestion') {
      const markdownPath = findPath('.md');
      const deepReportPath = findPath('.deep_report.json');
      const docJsonPath = findPath('.doc.json');
      const tableCsvCount = count(/\/artifacts\/table_\d+\.csv$/i);
      const tablePngCount = count(/\/artifacts\/table_\d+\.png$/i);
      return {
        ...base,
        objective: 'Verify extracted text/tree and table artifacts from source document.',
        stats: [
          { label: 'Markdown', value: markdownPath ? 'Ready' : 'Missing', tone: markdownPath ? 'success' : 'warning' },
          { label: 'Doc JSON', value: docJsonPath ? 'Ready' : 'Missing', tone: docJsonPath ? 'success' : 'warning' },
          { label: 'Table CSV', value: String(tableCsvCount), tone: tableCsvCount > 0 ? 'accent' : 'warning' },
          { label: 'Table PNG', value: String(tablePngCount), tone: tablePngCount > 0 ? 'accent' : 'warning' },
        ],
        keyFiles: [markdownPath, deepReportPath, docJsonPath]
          .filter(Boolean)
          .map((path) => ({ path, label: path.split('/').pop() || path })),
        actions: ['Run Phase', 'Open markdown for normalized text quality', 'Inspect table artifacts for extraction fidelity'],
      };
    }

    if (guidePhaseId === '02_structure') {
      const docStructurePath = findPath('/document_structure.json');
      const documentMiningPath = findPath('/document_mining.json');
      const chapterStructures = count(/\/CH-\d+\/chapter_structure\.json$/i);
      const practiceFiles = count(/\/CH-\d+\/practice_problems\.json$/i);
      const learningOutcomeFiles = count(/\/learning_outcomes\/chapter_learning_outcome\.json$/i);
      const caseStudies = count(/\/case_study\/SEC-\d+\.json$/i);
      const totalSections = phaseGuideExtra.structureTree.reduce((sum, chapter) => sum + chapter.sections.length, 0);
      return {
        ...base,
        objective: 'Validate chapter hierarchy, page ranges, outcomes, and practice/problem assets.',
        stats: [
          { label: 'Chapters', value: String(phaseGuideExtra.structureChapters.length), tone: phaseGuideExtra.structureChapters.length > 0 ? 'success' : 'warning' },
          { label: 'Sections', value: String(totalSections), tone: totalSections > 0 ? 'accent' : 'warning' },
          { label: 'Chapter Structures', value: String(chapterStructures), tone: chapterStructures > 0 ? 'success' : 'warning' },
          { label: 'Practice Sets', value: String(practiceFiles), tone: practiceFiles > 0 ? 'accent' : 'warning' },
          { label: 'Case Files', value: String(caseStudies), tone: caseStudies > 0 ? 'accent' : 'neutral' },
          { label: 'LO Files', value: String(learningOutcomeFiles), tone: learningOutcomeFiles > 0 ? 'accent' : 'neutral' },
        ],
        keyFiles: [docStructurePath, documentMiningPath]
          .filter(Boolean)
          .map((path) => ({ path, label: path.split('/').pop() || path })),
        actions: ['Run Phase', 'Review document_structure chapter/page mapping', 'Edit chapter structures then rerun downstream phases'],
        chapters: phaseGuideExtra.structureChapters,
        structureTree: phaseGuideExtra.structureTree,
      };
    }

    if (guidePhaseId === '04_knowledge') {
      const readyPath = findPath('/document_retrieval_ready.json');
      const bindingPath = findPath('/document_retrieval_binding_ready.json');
      return {
        ...base,
        objective: 'Confirm retrieval pack and binding outputs are generated and usable.',
        stats: [
          {
            label: 'Retrieval',
            value: phaseGuideExtra.knowledgeReady == null ? (readyPath ? 'Present' : 'Missing') : (phaseGuideExtra.knowledgeReady ? 'Ready' : 'Not ready'),
            tone: phaseGuideExtra.knowledgeReady == null ? (readyPath ? 'accent' : 'warning') : (phaseGuideExtra.knowledgeReady ? 'success' : 'danger'),
          },
          {
            label: 'Binding',
            value:
              phaseGuideExtra.knowledgeBindingReady == null
                ? (bindingPath ? 'Present' : 'Missing')
                : (phaseGuideExtra.knowledgeBindingReady ? 'Ready' : 'Not ready'),
            tone:
              phaseGuideExtra.knowledgeBindingReady == null
                ? (bindingPath ? 'accent' : 'warning')
                : (phaseGuideExtra.knowledgeBindingReady ? 'success' : 'danger'),
          },
          { label: 'Files', value: String(files.length), tone: files.length > 0 ? 'success' : 'warning' },
        ],
        keyFiles: [readyPath, bindingPath]
          .filter(Boolean)
          .map((path) => ({ path, label: path.split('/').pop() || path })),
        actions: ['Run Phase', 'Validate retrieval-ready and binding-ready payloads'],
      };
    }

    if (guidePhaseId === '07_slide') {
      return {
        ...base,
        objective: 'Generate slide packs and support per-slide targeted regeneration.',
        stats: [
          { label: 'Files', value: String(files.length), tone: files.length > 0 ? 'success' : 'warning' },
          {
            label: 'Thumbnails',
            value: String(phaseGuideExtra.slideThumbnails.length),
            tone: phaseGuideExtra.slideThumbnails.length > 0 ? 'accent' : 'warning',
          },
        ],
        actions: ['Run Phase', 'Use slide ID fields for targeted regenerate', 'Review slide JSON and image consistency'],
        slideThumbnails: phaseGuideExtra.slideThumbnails,
        slideThumbnailOverflow: phaseGuideExtra.slideThumbnailOverflow,
      };
    }

    if (guidePhaseId === '08_infographic') {
      return {
        ...base,
        objective: 'Produce infographic narratives/assets from structure and knowledge outputs.',
        actions: ['Run Phase', 'Review infographic JSON and visual outputs'],
      };
    }

    if (guidePhaseId === '06_assessment') {
      const assessedQuestions = phaseGuideExtra.assessmentCoverage.reduce((sum, row) => sum + row.questionCount, 0);
      return {
        ...base,
        objective: 'Generate assessment items mapped to chapter outcomes and sections.',
        stats: [
          { label: 'Files', value: String(files.length), tone: files.length > 0 ? 'success' : 'warning' },
          {
            label: 'Chapter Buckets',
            value: String(phaseGuideExtra.assessmentCoverage.length),
            tone: phaseGuideExtra.assessmentCoverage.length > 0 ? 'accent' : 'warning',
          },
          {
            label: 'Question Units',
            value: String(assessedQuestions),
            tone: assessedQuestions > 0 ? 'success' : 'warning',
          },
        ],
        actions: ['Run Phase', 'Review question quality, difficulty mix, and chapter coverage'],
        assessmentCoverage: phaseGuideExtra.assessmentCoverage,
      };
    }

    if (guidePhaseId === '05_mindmap') {
      return {
        ...base,
        objective: 'Build chapter mindmap structures and verify conceptual coverage.',
        actions: ['Run Phase', 'Review node coverage and hierarchy quality'],
      };
    }

    if (guidePhaseId === '09_video') {
      return {
        ...base,
        objective: 'Render video outputs from finalized instructional assets.',
      };
    }

    if (guidePhaseId === '10_learning') {
      return {
        ...base,
        objective: 'Generate learning intelligence outputs (plans/remediation/diagnostics).',
      };
    }

    return base;
  }, [artifacts, guidePhase, phaseGuideExtra, guidePhaseId]);

  const progressPercent = useMemo(() => {
    if (flow.steps.length === 0) return 0;
    if (completed) return 100;
    return Math.round(((currentStepIndex + 1) / flow.steps.length) * 100);
  }, [completed, currentStepIndex, flow.steps.length]);

  const resetRunState = useCallback(() => {
    setCurrentStepIndex(0);
    setCompleted(false);
    setDirection(1);
    setConfirmByStepId({});
  }, []);

  const applyJson = useCallback(() => {
    try {
      const next = parseFlowJson(rawJson);
      setFlow(next);
      setJsonError('');
      setSaveStatus('');
      resetRunState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse step JSON.';
      setJsonError(message);
    }
  }, [rawJson, resetRunState]);

  const loadApplications = useCallback(async () => {
    if (!connected) {
      setApplicationsError('Gateway disconnected');
      return;
    }
    setApplicationsLoading(true);
    setApplicationsError('');
    try {
      const payload = await gateway.call('ontosynth.applications.list', {});
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.applications.list failed'));
      }
      const parsed = parseOntoSynthApplications(payload);
      setApplications(parsed);
      setSelectedApplicationId((current) => {
        if (current && parsed.some((item) => item.id === current)) return current;
        return parsed[0]?.id || 'default';
      });
    } catch (error) {
      setApplications([]);
      setApplicationsError(getErrorMessage(error, 'Failed to load OntoSynth applications'));
      setSelectedApplicationId((current) => current || 'default');
    } finally {
      setApplicationsLoading(false);
    }
  }, [connected]);

  const loadCreationProfile = useCallback(
    async (applicationId: string, preferredDocumentName = '') => {
      if (!connected || !applicationId || applicationId === 'default') {
        setDocuments([]);
        setPhases([]);
        setSelectedDocumentName('');
        setSelectedPhaseId('');
        return;
      }
      try {
        const requestId = ++profileRequestRef.current;
        const requestAppId = applicationId;
        const payload = await gateway.call('ontosynth.creation.phase.profile', {
          applicationId,
          documentName: preferredDocumentName || undefined,
        });
        if (!payload || payload.status === 'error') {
          throw new Error(getErrorMessage(payload?.error, 'ontosynth.creation.phase.profile failed'));
        }
        if (profileRequestRef.current !== requestId) return;
        if (selectedApplicationIdRef.current !== requestAppId) return;

        const parsedDocs = parseCreationDocuments(payload);
        const parsedPhases = parseCreationPhases(payload);
        const selectedDocument = nonEmptyString((payload as Record<string, unknown>).selected_document);

        setDocuments(parsedDocs);
        setPhases(parsedPhases);
        setSelectedDocumentName((current) => {
          if (selectedDocument) return selectedDocument;
          if (current && parsedDocs.some((item) => item.name === current)) return current;
          return parsedDocs[0]?.name || '';
        });
        setSelectedPhaseId((current) => {
          if (current && parsedPhases.some((item) => item.id === current)) return current;
          const preferred = parsedPhases.find((item) => item.enabledByPipeline) || parsedPhases[0];
          return preferred?.id || '';
        });

        const hasSaved = !!readSavedFlowJson(applicationId);
        if (!hasSaved) {
          const backendFlow = flowFromPhases(selectedApplicationName, parsedPhases);
          const backendRawJson = JSON.stringify(backendFlow, null, 2);
          setFlow(backendFlow);
          setRawJson(backendRawJson);
        }
      } catch (error) {
        if (selectedApplicationIdRef.current !== applicationId) return;
        setDocuments([]);
        setPhases([]);
        setSelectedDocumentName('');
        setSelectedPhaseId('');
        setApplicationsError(getErrorMessage(error, 'Failed to load creation phase profile'));
      }
    },
    [connected, selectedApplicationName],
  );

  const loadArtifacts = useCallback(async () => {
    if (!connected || !selectedApplicationId || selectedApplicationId === 'default') {
      setArtifacts([]);
      setSelectedArtifactPath('');
      return;
    }
    if (!selectedDocumentName) {
      setArtifacts([]);
      setSelectedArtifactPath('');
      return;
    }
    setArtifactsLoading(true);
    setArtifactsError('');
    const requestId = ++artifactsRequestRef.current;
    const requestAppId = selectedApplicationId;
    const requestDocumentName = selectedDocumentName;
    const requestPhaseId = selectedPhaseId;
    try {
      const payload = await gateway.call('ontosynth.creation.artifacts.list', {
        applicationId: selectedApplicationId,
        documentName: selectedDocumentName,
        phaseId: selectedPhaseId || undefined,
        limit: 400,
      });
      if (artifactsRequestRef.current !== requestId) return;
      if (
        requestAppId !== selectedApplicationIdRef.current ||
        requestDocumentName !== selectedDocumentNameRef.current ||
        requestPhaseId !== selectedPhaseIdRef.current
      ) {
        return;
      }
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.creation.artifacts.list failed'));
      }
      const parsedArtifacts = parseCreationArtifacts(payload);
      const parsedDocs = parseCreationDocuments(payload);
      const parsedPhases = parseCreationPhases(payload);
      if (parsedDocs.length > 0) setDocuments(parsedDocs);
      if (parsedPhases.length > 0) setPhases(parsedPhases);
      setArtifacts(parsedArtifacts);
      setSelectedArtifactPath((current) => {
        if (current && parsedArtifacts.some((item) => item.relativePath === current)) return current;
        return parsedArtifacts[0]?.relativePath || '';
      });
    } catch (error) {
      if (
        artifactsRequestRef.current !== requestId ||
        requestAppId !== selectedApplicationIdRef.current ||
        requestDocumentName !== selectedDocumentNameRef.current ||
        requestPhaseId !== selectedPhaseIdRef.current
      ) {
        return;
      }
      setArtifacts([]);
      setSelectedArtifactPath('');
      setArtifactsError(getErrorMessage(error, 'Failed to load artifacts'));
    } finally {
      if (artifactsRequestRef.current === requestId) {
        setArtifactsLoading(false);
      }
    }
  }, [connected, selectedApplicationId, selectedDocumentName, selectedPhaseId]);

  const readArtifact = useCallback(async () => {
    if (!connected || !selectedArtifactPath) {
      setArtifactKind('');
      setArtifactMime('');
      setArtifactText('');
      setArtifactDataUrl('');
      setArtifactDirty(false);
      return;
    }
    setArtifactReadLoading(true);
    setArtifactStatus('');
    const requestId = ++artifactReadRequestRef.current;
    const requestArtifactPath = selectedArtifactPath;
    try {
      const payload = await gateway.call('ontosynth.creation.artifacts.read', { relativePath: selectedArtifactPath });
      if (artifactReadRequestRef.current !== requestId) return;
      if (requestArtifactPath !== selectedArtifactPathRef.current) return;
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.creation.artifacts.read failed'));
      }
      const previewType = nonEmptyString((payload as Record<string, unknown>).preview_type) as
        | 'json'
        | 'text'
        | 'image'
        | 'binary';
      const mime = nonEmptyString((payload as Record<string, unknown>).mime);
      const content = typeof (payload as Record<string, unknown>).content === 'string'
        ? ((payload as Record<string, unknown>).content as string)
        : '';
      const contentBase64 = typeof (payload as Record<string, unknown>).content_base64 === 'string'
        ? ((payload as Record<string, unknown>).content_base64 as string)
        : '';

      setArtifactKind(previewType || '');
      setArtifactMime(mime);
      if (previewType === 'image') {
        const trimmedContent = content.trim();
        if (contentBase64) {
          setArtifactDataUrl(`data:${mime || 'image/png'};base64,${contentBase64}`);
          setArtifactText('');
        } else if (trimmedContent.startsWith('data:')) {
          setArtifactDataUrl(trimmedContent);
          setArtifactText('');
        } else if (trimmedContent && (mime === 'image/svg+xml' || trimmedContent.startsWith('<svg'))) {
          setArtifactDataUrl(`data:${mime || 'image/svg+xml'};utf8,${encodeURIComponent(content)}`);
          setArtifactText('');
        } else {
          setArtifactDataUrl('');
          setArtifactText(content);
        }
      } else {
        setArtifactDataUrl('');
        setArtifactText(content);
      }
      setArtifactDirty(false);
    } catch (error) {
      if (artifactReadRequestRef.current !== requestId) return;
      if (requestArtifactPath !== selectedArtifactPathRef.current) return;
      setArtifactKind('');
      setArtifactMime('');
      setArtifactText('');
      setArtifactDataUrl('');
      setArtifactDirty(false);
      setArtifactStatus(getErrorMessage(error, 'Failed to read artifact'));
    } finally {
      if (artifactReadRequestRef.current === requestId) {
        setArtifactReadLoading(false);
      }
    }
  }, [connected, selectedArtifactPath]);

  const saveArtifact = useCallback(async () => {
    if (!connected || !selectedArtifactPath) return;
    if (!(artifactKind === 'json' || artifactKind === 'text')) return;
    if (!selectedArtifact?.editable) return;
    try {
      const payload = await gateway.call('ontosynth.creation.artifacts.write', {
        relativePath: selectedArtifactPath,
        content: artifactText,
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.creation.artifacts.write failed'));
      }
      setArtifactDirty(false);
      setArtifactStatus('Artifact saved');
      void loadArtifacts();
    } catch (error) {
      setArtifactStatus(getErrorMessage(error, 'Failed to save artifact'));
    }
  }, [connected, selectedArtifact, selectedArtifactPath, artifactKind, artifactText, loadArtifacts]);

  const populateSlideIdsFromArtifact = useCallback(() => {
    if (artifactKind !== 'json' || !artifactText.trim()) {
      setRegenStatus((prev) => ({
        ...prev,
        message: 'Select a slide JSON artifact first to auto-fill IDs.',
      }));
      return;
    }
    const parsed = parseSlideIdentifiersFromJson(artifactText);
    setSlideDocId((prev) => prev || parsed.docId);
    setSlideChapterId((prev) => prev || parsed.chapterId);
    setSlideSectionId((prev) => prev || parsed.sectionId);
    setSlideItemId((prev) => prev || parsed.slideId);
    if (!parsed.docId || !parsed.chapterId || !parsed.sectionId || !parsed.slideId) {
      setRegenStatus((prev) => ({
        ...prev,
        message: 'Some slide IDs were not found in JSON. Fill the missing fields manually.',
      }));
      return;
    }
    setRegenStatus((prev) => ({
      ...prev,
      message: 'Slide identifiers filled from artifact JSON.',
    }));
  }, [artifactKind, artifactText]);

  const regeneratePhase = useCallback(async () => {
    if (!connected || !selectedApplicationId || !selectedDocumentName || !selectedPhaseId) return;
    setStepPollCount(0);
    setStepLastUpdateAt(null);
    setStepLastPollError('');
    setStepLogCopyStatus('');
    setRegenStatus({
      status: 'running',
      message: 'Starting phase run...',
      runId: '',
      logTail: '',
      mode: 'phase',
    });
    try {
      const payload = await gateway.call('ontosynth.creation.phase.run.start', {
        applicationId: selectedApplicationId,
        documentName: selectedDocumentName,
        phaseId: selectedPhaseId,
        includePrerequisites: true,
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.creation.phase.run.start failed'));
      }
      const record = asRecord(payload);
      const status = normalizeStepRunStatus(record);
      const runId = pickString(record || {}, ['run_id', 'runId']);
      setRegenStatus({
        status,
        message: pickString(record || {}, ['message']) || 'Phase run started',
        runId,
        logTail: pickString(record || {}, ['log_tail', 'logTail']),
        mode: 'phase',
      });
    } catch (error) {
      setRegenStatus({
        status: 'error',
        message: getErrorMessage(error, 'Failed to start phase run'),
        runId: '',
        logTail: '',
        mode: 'phase',
      });
    }
  }, [connected, selectedApplicationId, selectedDocumentName, selectedPhaseId]);

  const regenerateSlide = useCallback(async () => {
    if (!connected || !selectedApplicationId) return;
    const docId = slideDocId.trim();
    const chapterId = slideChapterId.trim();
    const sectionId = slideSectionId.trim();
    const slideId = slideItemId.trim();
    if (!docId || !chapterId || !sectionId || !slideId) {
      setRegenStatus({
        status: 'error',
        message: 'Slide run requires docId, chapterId, sectionId, and slideId.',
        runId: '',
        logTail: '',
        mode: 'slide',
      });
      return;
    }

    setStepPollCount(0);
    setStepLastUpdateAt(null);
    setStepLastPollError('');
    setStepLogCopyStatus('');
    setRegenStatus({
      status: 'running',
      message: 'Starting slide regeneration...',
      runId: '',
      logTail: '',
      mode: 'slide',
    });
    try {
      const payload = await gateway.call('ontosynth.creation.slide.regenerate.start', {
        applicationId: selectedApplicationId,
        documentName: selectedDocumentName || undefined,
        docId,
        chapterId,
        sectionId,
        slideId,
        revisionNote: slideRevisionNote.trim() || undefined,
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.creation.slide.regenerate.start failed'));
      }
      const record = asRecord(payload);
      const status = normalizeStepRunStatus(record);
      const runId = pickString(record || {}, ['run_id', 'runId']);
      setRegenStatus({
        status,
        message: pickString(record || {}, ['message']) || 'Slide regeneration started',
        runId,
        logTail: pickString(record || {}, ['log_tail', 'logTail']),
        mode: 'slide',
      });
    } catch (error) {
      setRegenStatus({
        status: 'error',
        message: getErrorMessage(error, 'Failed to start slide regeneration'),
        runId: '',
        logTail: '',
        mode: 'slide',
      });
    }
  }, [
    connected,
    selectedApplicationId,
    selectedDocumentName,
    slideChapterId,
    slideDocId,
    slideItemId,
    slideRevisionNote,
    slideSectionId,
  ]);

  const cancelPhaseOrSlideRun = useCallback(async () => {
    if (!isStepRunActive(regenStatus.status)) return;
    const method =
      regenStatus.mode === 'slide'
        ? 'ontosynth.creation.slide.regenerate.cancel'
        : 'ontosynth.creation.phase.run.cancel';
    try {
      const payload = await gateway.call(method, {});
      const record = asRecord(payload);
      const status = normalizeStepRunStatus(record);
      setRegenStatus((prev) => ({
        ...prev,
        status,
        message: pickString(record || {}, ['message']) || 'Run cancelled',
        logTail: pickString(record || {}, ['log_tail', 'logTail']) || prev.logTail,
      }));
    } catch (error) {
      setRegenStatus((prev) => ({
        ...prev,
        message: getErrorMessage(error, 'Failed to cancel run'),
      }));
    }
  }, [regenStatus.mode, regenStatus.status]);

  const refreshStepRunStatus = useCallback(async () => {
    if (!regenStatus.runId) return;
    const statusMethod =
      regenStatus.mode === 'slide'
        ? 'ontosynth.creation.slide.regenerate.status'
        : 'ontosynth.creation.phase.run.status';
    try {
      const payload = await gateway.call(statusMethod, {
        runId: regenStatus.runId,
        tailLines: 120,
      });
      if (!payload) {
        throw new Error('Empty status payload');
      }
      if (payload.status === 'error') {
        throw new Error(getErrorMessage(payload.error, `${statusMethod} failed`));
      }
      const record = asRecord(payload);
      const status = normalizeStepRunStatus(record);
      const message = pickString(record || {}, ['message']);
      const logTail = pickString(record || {}, ['log_tail', 'logTail']);
      setRegenStatus((prev) => ({
        ...prev,
        status,
        message: message || prev.message,
        logTail: logTail || prev.logTail,
      }));
      setStepPollCount((prev) => prev + 1);
      setStepLastUpdateAt(Date.now());
      setStepLastPollError('');
      if (!isStepRunActive(status)) {
        void loadArtifacts();
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Polling step run status failed');
      setStepLastPollError(message);
      setRegenStatus((prev) => ({
        ...prev,
        message,
      }));
    }
  }, [loadArtifacts, regenStatus.mode, regenStatus.runId]);

  const onSave = useCallback(() => {
    try {
      const next = parseFlowJson(rawJson);
      setFlow(next);
      setJsonError('');
      resetRunState();
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(flowStorageKey(selectedApplicationId || 'default'), rawJson);
        }
        setSaveStatus(`Saved for ${selectedApplicationName}`);
      } catch {
        setSaveStatus('Saved (session only)');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse step JSON.';
      setJsonError(message);
      setSaveStatus('');
    }
  }, [rawJson, resetRunState, selectedApplicationId, selectedApplicationName]);

  const onContinue = useCallback(() => {
    if (continueDisabled) return;
    if (currentStepIndex >= flow.steps.length - 1) {
      setCompleted(true);
      return;
    }
    setDirection(1);
    setCurrentStepIndex((value) => value + 1);
  }, [continueDisabled, currentStepIndex, flow.steps.length]);

  const onBack = useCallback(() => {
    if (completed) {
      setCompleted(false);
      return;
    }
    if (currentStepIndex <= 0) return;
    setDirection(-1);
    setCurrentStepIndex((value) => value - 1);
  }, [completed, currentStepIndex]);

  const selectMaterialFiles = useCallback(async (bucket: MaterialBucket) => {
    if (typeof window === 'undefined') return;
    try {
      const result = await window.aegis.file.openDialog();
      if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) return;
      setSelectedMaterialFiles((prev) => {
        const existing = new Map(prev.map((item) => [item.path, item]));
        for (const filePath of result.filePaths) {
          const path = String(filePath || '').trim();
          if (!path) continue;
          if (!existing.has(path)) {
            existing.set(path, { path, bucket });
          } else {
            const current = existing.get(path);
            if (current) existing.set(path, { ...current, bucket });
          }
        }
        return Array.from(existing.values());
      });
      setMaterialsError('');
      setMaterialsStatus('');
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to open file picker');
      setMaterialsError(message);
    }
  }, []);

  const setMaterialBucket = useCallback((filePath: string, bucket: MaterialBucket) => {
    setSelectedMaterialFiles((prev) =>
      prev.map((item) => (item.path === filePath ? { ...item, bucket } : item)),
    );
  }, []);

  const removeMaterialFile = useCallback((filePath: string) => {
    setSelectedMaterialFiles((prev) => prev.filter((item) => item.path !== filePath));
  }, []);

  const clearMaterialFiles = useCallback(() => {
    setSelectedMaterialFiles([]);
  }, []);

  const markCreateProgressStep = useCallback(
    (stepId: CreateProgressStep['id'], status: CreateProgressStatus, detail: string) => {
      setCreateProgressSteps((prev) => updateCreateProgressStep(prev, stepId, status, detail));
      setCreateProgressUpdatedAt(Date.now());
    },
    [],
  );

  const createAndAttachApplication = useCallback(async () => {
    const displayName = newApplicationName.trim();
    const explicitId = newApplicationId.trim();
    const resolvedId = explicitId || toApplicationId(displayName);
    const version = applicationVersion.trim() || 'v2026';
    const dbNamespace = 'local_duckdb';
    const dbName = `${resolvedId}_${version}`;
    const dbUri = `duckdb:///user_files/data/${resolvedId}_${version}.duckdb`;
    const dbSchema = 'main';
    setCreateProgressSteps(newCreateProgressSteps());
    setCreateProgressMessage('Validating request...');
    setCreateProgressUpdatedAt(Date.now());
    setCreatePipelineRunId('');
    setCreatePipelineStatus('idle');
    setCreatePipelineMessage('');
    setCreatePipelineLogTail('');
    setCreatePipelineApplicationId('');
    setCreatePipelineCurrentPhaseId('');
    setCreatePipelineSeenPhaseIds([]);
    setCreatePipelinePhases(newPipelinePhases());
    setCreatePipelineDebugText('');
    setCreatePipelinePollCount(0);
    setCreatePipelineLastError('');
    if (!displayName) {
      setCreateError('Application name is required');
      setCreateStatus('');
      markCreateProgressStep('validate', 'error', 'Application name is required');
      markCreateProgressStep('finish', 'error', 'Validation failed');
      setCreateProgressMessage('Validation failed');
      return;
    }
    if (!resolvedId) {
      setCreateError('Application ID is required');
      setCreateStatus('');
      markCreateProgressStep('validate', 'error', 'Application ID is required');
      markCreateProgressStep('finish', 'error', 'Validation failed');
      setCreateProgressMessage('Validation failed');
      return;
    }
    if (selectedMaterialFiles.length === 0) {
      setMaterialsError('Select at least one material file');
      setMaterialsStatus('');
      markCreateProgressStep('validate', 'error', 'No material files selected');
      markCreateProgressStep('finish', 'error', 'Validation failed');
      setCreateProgressMessage('Validation failed');
      return;
    }
    if (!connected) {
      setCreateError('Gateway disconnected');
      setCreateStatus('');
      markCreateProgressStep('validate', 'error', 'Gateway disconnected');
      markCreateProgressStep('finish', 'error', 'Validation failed');
      setCreateProgressMessage('Validation failed');
      return;
    }
    let parsedGlobalTaskParams: JsonObject = {};
    try {
      parsedGlobalTaskParams = parseJsonObject(createGlobalTaskParamsRaw);
      setCreateGlobalTaskParamsError('');
    } catch (error) {
      const message = getErrorMessage(error, 'Invalid global task params JSON');
      setCreateGlobalTaskParamsError(message);
      setCreateError(`Global task params: ${message}`);
      markCreateProgressStep('validate', 'error', 'Invalid global task params');
      markCreateProgressStep('finish', 'error', 'Validation failed');
      setCreateProgressMessage('Validation failed');
      return;
    }

    const parsedPhaseSettings: Record<string, JsonObject> = {};
    const phaseSettingsErrors: Record<string, string> = {};
    for (const phaseId of createEnabledPhaseIds) {
      const raw = createPhaseSettingsRawById[phaseId] || '{}';
      try {
        parsedPhaseSettings[phaseId] = parseJsonObject(raw);
      } catch (error) {
        phaseSettingsErrors[phaseId] = getErrorMessage(error, 'Invalid JSON object');
      }
    }
    if (Object.keys(phaseSettingsErrors).length > 0) {
      setCreatePhaseSettingsErrorById((prev) => ({ ...prev, ...phaseSettingsErrors }));
      setCreateError('One or more phase settings JSON blocks are invalid');
      markCreateProgressStep('validate', 'error', 'Invalid phase settings');
      markCreateProgressStep('finish', 'error', 'Validation failed');
      setCreateProgressMessage('Validation failed');
      return;
    }
    setCreatePhaseSettingsErrorById({});

    markCreateProgressStep('validate', 'success', 'Request validated');
    markCreateProgressStep('create', 'running', 'Creating application scaffold...');
    setCreateProgressMessage('Creating application scaffold...');
    setCreatingApplication(true);
    setCreateError('');
    setCreateStatus('');
    setMaterialsError('');
    setMaterialsStatus('');
    let keepCreatingForPipeline = false;
    try {
      const payload = await gateway.call('ontosynth.creation.application.create', {
        applicationId: resolvedId,
        applicationName: displayName,
        template: pipelineTemplate,
        version,
        sourceMode,
        sourceFilename,
        phaseProfile: {
          textbook: createEnabledPhaseIds.includes('00_textbook'),
          video: createEnabledPhaseIds.includes('09_video'),
          learning: createEnabledPhaseIds.includes('10_learning'),
          enabledPhaseIds: createEnabledPhaseIds,
        },
        policy: {
          modelPreset: modelPolicyPreset,
          schemaPreset: knowledgeSchemaPreset,
        },
        taskParams: parsedGlobalTaskParams,
        phaseSettings: parsedPhaseSettings,
        datus: {
          namespace: dbNamespace,
          dbName,
          dbUri,
          schema: dbSchema,
        },
      });
      if (!payload || payload.status === 'error') {
        throw new Error(getErrorMessage(payload?.error, 'ontosynth.creation.application.create failed'));
      }
      const record = asRecord(payload) || {};
      const createdId = pickString(record, ['application_id', 'applicationId']) || resolvedId;
      const createdName = pickString(record, ['application_name', 'applicationName']) || displayName;
      markCreateProgressStep('create', 'success', `Created ${createdId}`);
      markCreateProgressStep(
        'attach',
        'running',
        `Attaching ${selectedMaterialFiles.length} file(s)...`,
      );
      setCreateProgressMessage('Attaching materials...');
      setCreatedApplicationId(createdId);
      setSelectedApplicationId(createdId);
      setCreateStatus(`Application created: ${createdName} (${createdId})`);
      setCreateError('');
      setNewApplicationId(createdId);
      void loadApplications();

      try {
        const attachPayload = await gateway.call('ontosynth.creation.materials.attach', {
          applicationId: createdId,
          officialTextbooks: officialMaterialPaths,
          rawMaterials: rawMaterialPaths,
          sourceMode,
          sourceFilename,
        });
        if (!attachPayload || attachPayload.status === 'error') {
          throw new Error(getErrorMessage(attachPayload?.error, 'ontosynth.creation.materials.attach failed'));
        }
        setMaterialsStatus('Materials submitted');
        setMaterialsError('');
        markCreateProgressStep('attach', 'success', 'Materials attached');
        markCreateProgressStep('pipeline', 'running', 'Starting OntoSynth pipeline...');
        setCreateProgressMessage('Starting OntoSynth pipeline...');

        const runPayload = await gateway.call('ontosynth.creation.regenerate.start', {
          applicationId: createdId,
          mode: 'rerun_pipeline',
          cleanPhase: false,
        });
        if (!runPayload || runPayload.status === 'error') {
          throw new Error(getErrorMessage(runPayload?.error, 'ontosynth.creation.regenerate.start failed'));
        }
        const runRecord = asRecord(runPayload) || {};
        const runId = pickString(runRecord, ['run_id', 'runId']);
        const statusRaw = pickString(runRecord, ['run_status', 'runStatus', 'status']).toLowerCase();
        const runStatus: 'running' | 'success' | 'error' | 'cancelled' =
          statusRaw === 'success'
            ? 'success'
            : statusRaw === 'error'
              ? 'error'
              : statusRaw === 'cancelled'
                ? 'cancelled'
                : 'running';
        const runMessage = pickString(runRecord, ['message']) || 'Pipeline started';
        const runLogTail = pickString(runRecord, ['log_tail', 'logTail']);
        const runtimePhases = parsePipelineRuntimePhases(runRecord);
        const runtimeRecord = asRecord(runRecord.phase_runtime);
        const runtimeCurrentPhaseId = pickString(runtimeRecord || {}, ['current_phase_id', 'currentPhaseId']);
        const detectedIds = detectPipelinePhaseIdsFromLog(runLogTail);
        const currentDetected = runtimeCurrentPhaseId || detectedIds[detectedIds.length - 1] || '';
        const seenSet = new Set(
          runtimePhases
            .filter((phase) => phase.status === 'success')
            .map((phase) => phase.id),
        );
        for (const id of detectedIds) seenSet.add(id);
        setCreatePipelineRunId(runId);
        setCreatePipelineStatus(runStatus);
        setCreatePipelineMessage(runMessage);
        setCreatePipelineLogTail(runLogTail);
        setCreatePipelineApplicationId(createdId);
        setCreatePipelineCurrentPhaseId(currentDetected);
        setCreatePipelineSeenPhaseIds(Array.from(seenSet));
        if (runtimePhases.length > 0) {
          setCreatePipelinePhases(runtimePhases);
        } else {
          setCreatePipelinePhases((prev) => applyPipelinePhaseStatuses(prev, seenSet, currentDetected, runStatus));
        }
        setCreatePipelineDebugText(
          JSON.stringify(
            {
              status: runStatus,
              runId,
              applicationId: createdId,
              message: runMessage,
            },
            null,
            2,
          ),
        );

        if (runStatus === 'success') {
          markCreateProgressStep('pipeline', 'success', 'Pipeline completed');
          markCreateProgressStep('finish', 'success', 'Create flow completed');
          setCreateProgressMessage('Create flow completed');
        } else if (runStatus === 'error' || runStatus === 'cancelled') {
          const terminalMessage =
            runStatus === 'cancelled' ? 'Pipeline cancelled' : 'Pipeline failed';
          markCreateProgressStep('pipeline', 'error', runMessage || terminalMessage);
          markCreateProgressStep('finish', 'error', terminalMessage);
          setCreateProgressMessage(terminalMessage);
        } else {
          keepCreatingForPipeline = true;
          markCreateProgressStep('pipeline', 'running', runMessage || 'Pipeline is running');
          setCreateProgressMessage('Pipeline is running...');
        }
      } catch (attachError) {
        const attachMessage = getErrorMessage(attachError, 'Failed to submit materials');
        setMaterialsError(attachMessage);
        setMaterialsStatus('');
        markCreateProgressStep('attach', 'error', attachMessage);
        markCreateProgressStep('pipeline', 'error', 'Not started');
        markCreateProgressStep('finish', 'error', 'Application created with attach/pipeline error');
        setCreateProgressMessage('Application created with attach/pipeline error');
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to create application');
      setCreateError(message);
      setCreateStatus('');
      setCreatedApplicationId('');
      setMaterialsStatus('');
      markCreateProgressStep('create', 'error', message);
      markCreateProgressStep('finish', 'error', 'Create flow failed');
      setCreateProgressMessage('Create flow failed');
    } finally {
      if (!keepCreatingForPipeline) {
        setCreatingApplication(false);
      }
      setCreateProgressUpdatedAt(Date.now());
    }
  }, [
    applicationVersion,
    connected,
    createEnabledPhaseIds,
    createGlobalTaskParamsRaw,
    createPhaseSettingsRawById,
    gateway,
    knowledgeSchemaPreset,
    loadApplications,
    modelPolicyPreset,
    newApplicationId,
    newApplicationName,
    officialMaterialPaths,
    pipelineTemplate,
    rawMaterialPaths,
    selectedMaterialFiles.length,
    sourceFilename,
    sourceMode,
    markCreateProgressStep,
  ]);

  const cancelCreatePipeline = useCallback(async () => {
    if (!createPipelineRunning) return;
    try {
      const payload = await gateway.call('ontosynth.creation.regenerate.cancel', {});
      const record = asRecord(payload) || {};
      const message = pickString(record, ['message']) || 'Pipeline cancelled';
      setCreatePipelineStatus('cancelled');
      setCreatePipelineMessage(message);
      markCreateProgressStep('pipeline', 'error', message);
      markCreateProgressStep('finish', 'error', 'Create flow cancelled');
      setCreateProgressMessage('Create flow cancelled');
      setCreatingApplication(false);
      setCreateProgressUpdatedAt(Date.now());
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to cancel pipeline');
      setCreatePipelineMessage(message);
      setCreateProgressUpdatedAt(Date.now());
    }
  }, [createPipelineRunning, markCreateProgressStep]);

  const openCreatedApplicationInEdit = useCallback(() => {
    const appId = createdApplicationId || newApplicationId.trim() || toApplicationId(newApplicationName);
    if (!appId) return;
    setSelectedApplicationId(appId);
    setWorkflowMode('edit');
  }, [
    createdApplicationId,
    newApplicationId,
    newApplicationName,
    setSelectedApplicationId,
  ]);

  useEffect(() => {
    if (connected) {
      void loadApplications();
      return;
    }
    setApplicationsError('Gateway disconnected');
    setDocuments([]);
    setPhases([]);
    setArtifacts([]);
    setSelectedDocumentName('');
    setSelectedPhaseId('');
    setSelectedArtifactPath('');
    setSlideDocId('');
    setSlideChapterId('');
    setSlideSectionId('');
    setSlideItemId('');
    setSlideRevisionNote('');
    setRegenStatus({ status: 'idle', message: '', runId: '', logTail: '', mode: '' });
  }, [connected, loadApplications]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CREATION_APP_STORAGE_KEY, selectedApplicationId || 'default');
    } catch {
      // Ignore storage persistence errors.
    }
  }, [selectedApplicationId]);

  useEffect(() => {
    if (!createPipelineRunId || createPipelineStatus !== 'running') return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        setCreatePipelinePollCount((value) => value + 1);
        const statusParams: Record<string, unknown> = {
          runId: createPipelineRunId,
          tailLines: 160,
        };
        if (createPipelineApplicationId) statusParams.applicationId = createPipelineApplicationId;
        const payload = await gateway.call('ontosynth.creation.regenerate.status', statusParams);
        if (cancelled) return;
        if (!payload || payload.status === 'error') {
          const pollError = getErrorMessage(
            payload && typeof payload === 'object' ? (payload as Record<string, unknown>).error : null,
            'ontosynth.creation.regenerate.status failed',
          );
          setCreatePipelineLastError(pollError);
          setCreatePipelineStatus('error');
          setCreatePipelineMessage(pollError);
          setCreateProgressMessage('Create flow failed');
          markCreateProgressStep('pipeline', 'error', pollError);
          markCreateProgressStep('finish', 'error', 'Create flow failed');
          setCreatingApplication(false);
          return;
        }
        setCreatePipelineLastError('');
        const record = asRecord(payload) || {};
        const statusRaw = pickString(record, ['run_status', 'runStatus', 'status']).toLowerCase();
        const isRunningStatus = statusRaw === 'running' || statusRaw === 'started' || statusRaw === 'queued';
        const nextStatus: 'running' | 'success' | 'error' | 'cancelled' =
          statusRaw === 'success'
            ? 'success'
            : statusRaw === 'error'
              ? 'error'
              : statusRaw === 'cancelled'
                ? 'cancelled'
                : statusRaw === 'idle'
                  ? 'cancelled'
                  : isRunningStatus
                    ? 'running'
                    : 'error';
        const message =
          pickString(record, ['message']) ||
          createPipelineMessage ||
          (statusRaw === 'idle'
            ? 'Run state reset to idle.'
            : nextStatus === 'error'
              ? `Unexpected run status: ${statusRaw || 'unknown'}`
              : '');
        const runLogTail = pickString(record, ['log_tail', 'logTail']);
        const runtimePhaseRows = parsePipelineRuntimePhases(record);
        const runtimeRecord = asRecord(record.phase_runtime);
        const runtimeCurrentPhaseId = pickString(runtimeRecord || {}, ['current_phase_id', 'currentPhaseId']);
        const detectedIds = detectPipelinePhaseIdsFromLog(runLogTail);
        const phaseProgressRecord = asRecord(record.phase_progress);
        const phaseRows = Array.isArray(phaseProgressRecord?.phases) ? phaseProgressRecord.phases : [];
        if (runtimePhaseRows.length > 0) {
          setCreatePipelinePhases(runtimePhaseRows);
          const seenSuccessIds = runtimePhaseRows
            .filter((phase) => phase.status === 'success')
            .map((phase) => phase.id);
          setCreatePipelineSeenPhaseIds(seenSuccessIds);
          const runningId = runtimePhaseRows.find((phase) => phase.status === 'running')?.id || '';
          const currentDetected = runtimeCurrentPhaseId || runningId || createPipelineCurrentPhaseId;
          setCreatePipelineCurrentPhaseId(currentDetected);
        } else if (phaseRows.length > 0) {
          const phaseMapped = phaseRows
            .map((item) => {
              const phase = asRecord(item);
              if (!phase) return null;
              const id = pickString(phase, ['id']);
              const title = pickString(phase, ['title']) || id;
              if (!id || !title) return null;
              return {
                id,
                title,
                present: pickBoolean(phase, ['present'], false),
                enabledByPipeline: pickBoolean(phase, ['enabled_by_pipeline', 'enabledByPipeline'], false),
                order: Number(phase.order ?? 999),
              };
            })
            .filter((item): item is { id: string; title: string; present: boolean; enabledByPipeline: boolean; order: number } => !!item)
            .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
          const seen = new Set(
            phaseMapped.filter((phase) => phase.present).map((phase) => phase.id),
          );
          for (const id of detectedIds) seen.add(id);
          const firstPendingEnabled =
            phaseMapped.find((phase) => phase.enabledByPipeline && !seen.has(phase.id))?.id || '';
          const currentDetected = detectedIds[detectedIds.length - 1] || firstPendingEnabled || createPipelineCurrentPhaseId;
          setCreatePipelineCurrentPhaseId(currentDetected);
          setCreatePipelineSeenPhaseIds(Array.from(seen));
          setCreatePipelinePhases(
            phaseMapped.map((phase) => {
              if (nextStatus === 'error' || nextStatus === 'cancelled') {
                if (phase.id === currentDetected) return { id: phase.id, title: phase.title, status: 'error' as const };
                if (seen.has(phase.id)) return { id: phase.id, title: phase.title, status: 'success' as const };
                return { id: phase.id, title: phase.title, status: 'pending' as const };
              }
              if (nextStatus === 'success') {
                if (seen.has(phase.id) || phase.present) return { id: phase.id, title: phase.title, status: 'success' as const };
                return { id: phase.id, title: phase.title, status: 'pending' as const };
              }
              if (phase.id === currentDetected) return { id: phase.id, title: phase.title, status: 'running' as const };
              if (seen.has(phase.id) || phase.present) return { id: phase.id, title: phase.title, status: 'success' as const };
              return { id: phase.id, title: phase.title, status: 'pending' as const };
            }),
          );
        } else {
          setCreatePipelineSeenPhaseIds((prev) => {
            const merged = new Set(prev);
            for (const id of detectedIds) merged.add(id);
            const mergedList = Array.from(merged);
            const currentDetected = detectedIds[detectedIds.length - 1] || createPipelineCurrentPhaseId;
            setCreatePipelineCurrentPhaseId(currentDetected);
            setCreatePipelinePhases((phasePrev) =>
              applyPipelinePhaseStatuses(phasePrev, merged, currentDetected, nextStatus),
            );
            return mergedList;
          });
        }
        setCreatePipelineStatus(nextStatus);
        setCreatePipelineMessage(message);
        setCreatePipelineLogTail(runLogTail);
        setCreatePipelineDebugText(
          JSON.stringify(
            {
              runId: createPipelineRunId,
              transportStatus: pickString(record, ['status']),
              runStatus: pickString(record, ['run_status', 'runStatus', 'status']),
              status: nextStatus,
              message,
              applicationId: createPipelineApplicationId || pickString(record, ['application_id', 'applicationId']),
              process: asRecord(record.process_debug) || null,
              log: asRecord(record.log_debug) || null,
              phaseRuntime: asRecord(record.phase_runtime) || null,
              phaseProgress: asRecord(record.phase_progress) || null,
            },
            null,
            2,
          ),
        );
        setCreateProgressUpdatedAt(Date.now());
        if (nextStatus === 'success') {
          markCreateProgressStep('pipeline', 'success', 'Pipeline completed');
          markCreateProgressStep('finish', 'success', 'Create flow completed');
          setCreateProgressMessage('Create flow completed');
          setCreatingApplication(false);
          window.clearInterval(timer);
        } else if (nextStatus === 'error' || nextStatus === 'cancelled') {
          const endMessage = nextStatus === 'cancelled' ? 'Pipeline cancelled' : 'Pipeline failed';
          markCreateProgressStep('pipeline', 'error', message || endMessage);
          markCreateProgressStep('finish', 'error', endMessage);
          setCreateProgressMessage(endMessage);
          setCreatingApplication(false);
          window.clearInterval(timer);
        } else {
          markCreateProgressStep(
            'pipeline',
            'running',
            createPipelineCurrentPhaseId
              ? `Running ${createPipelineCurrentPhaseTitle || createPipelineCurrentPhaseId}`
              : (message || 'Pipeline is running'),
          );
          setCreateProgressMessage('Pipeline is running...');
        }
      } catch (error) {
        const message = getErrorMessage(error, 'Polling regenerate.status failed');
        setCreatePipelineLastError(message);
        setCreatePipelineDebugText(
          JSON.stringify(
            {
              runId: createPipelineRunId,
              status: createPipelineStatus,
              applicationId: createPipelineApplicationId,
              pollError: message,
              pollCount: createPipelinePollCount + 1,
              at: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        setCreateProgressUpdatedAt(Date.now());
      }
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    createPipelineCurrentPhaseId,
    createPipelineCurrentPhaseTitle,
    createPipelineApplicationId,
    createPipelineMessage,
    createPipelineRunId,
    createPipelineStatus,
    markCreateProgressStep,
  ]);

  useEffect(() => {
    const appId = selectedApplicationId || 'default';
    const saved = readInitialRawJson(appId);
    try {
      const parsed = parseFlowJson(saved);
      setRawJson(saved);
      setFlow(parsed);
      setJsonError('');
    } catch {
      const fallback = SAMPLE_FLOW_JSON;
      setRawJson(fallback);
      setFlow(parseFlowJson(fallback));
      setJsonError('');
    }
    setSaveStatus('');
    setSelectedDocumentName('');
    setSelectedPhaseId('');
    setSelectedArtifactPath('');
    setArtifacts([]);
    setArtifactStatus('');
    setSlideDocId('');
    setSlideChapterId('');
    setSlideSectionId('');
    setSlideItemId('');
    setSlideRevisionNote('');
    setRegenStatus({ status: 'idle', message: '', runId: '', logTail: '', mode: '' });
    setStepPollCount(0);
    setStepLastUpdateAt(null);
    setStepLastPollError('');
    setStepLogCopyStatus('');
    resetRunState();
  }, [selectedApplicationId, resetRunState]);

  useEffect(() => {
    if (!connected || !selectedApplicationId || selectedApplicationId === 'default') return;
    void loadCreationProfile(selectedApplicationId);
  }, [connected, selectedApplicationId, loadCreationProfile]);

  useEffect(() => {
    if (!connected || !selectedApplicationId || selectedApplicationId === 'default') return;
    if (!selectedDocumentName) return;
    void loadArtifacts();
  }, [connected, selectedApplicationId, selectedDocumentName, selectedPhaseId, loadArtifacts]);

  useEffect(() => {
    if (workflowMode !== 'edit') return;
    const stepPhaseId = currentStep?.id || '';
    if (!stepPhaseId || !phases.some((phase) => phase.id === stepPhaseId)) return;
    if (selectedPhaseId !== stepPhaseId) {
      setSelectedPhaseId(stepPhaseId);
      setSelectedArtifactPath('');
      setArtifactStatus('');
    }
  }, [workflowMode, currentStep?.id, phases, selectedPhaseId]);

  useEffect(() => {
    void readArtifact();
  }, [readArtifact]);

  useEffect(() => {
    if (workflowMode !== 'edit') return;
    const widgetPhaseIds = new Set(['02_structure', '04_knowledge', '06_assessment', '07_slide']);
    if (!connected || !selectedApplicationId || selectedApplicationId === 'default' || !guidePhaseId) {
      setPhaseGuideLoading(false);
      setPhaseGuideError('');
      setPhaseGuideExtra(emptyPhaseGuideExtra());
      return;
    }
    if (!widgetPhaseIds.has(guidePhaseId)) {
      setPhaseGuideLoading(false);
      setPhaseGuideError('');
      setPhaseGuideExtra(emptyPhaseGuideExtra());
      return;
    }

    let cancelled = false;
    const readJsonRecord = async (relativePath: string): Promise<Record<string, unknown> | null> => {
      if (!relativePath) return null;
      const payload = await gateway.call('ontosynth.creation.artifacts.read', { relativePath });
      if (!payload || payload.status === 'error') return null;
      const record = asRecord(payload);
      const content = typeof record?.content === 'string' ? record.content : '';
      return safeParseJsonRecord(content);
    };

    const loadGuide = async () => {
      setPhaseGuideLoading(true);
      setPhaseGuideError('');
      try {
        if (guidePhaseId === '02_structure') {
          const target = artifacts.find((item) => item.relativePath.toLowerCase().endsWith('/document_structure.json'));
          if (!target) {
            if (!cancelled) {
              setPhaseGuideExtra(emptyPhaseGuideExtra());
            }
            return;
          }
          const parsed = await readJsonRecord(target.relativePath);
          if (!parsed) throw new Error('Failed to parse document_structure.json');
          const rawChapters = Array.isArray(parsed?.chapters) ? parsed?.chapters : [];
          const chapters = rawChapters
            .map((raw) => {
              const chapter = asRecord(raw);
              if (!chapter) return null;
              const id = pickString(chapter, ['cid', 'id']);
              const title = pickString(chapter, ['title', 'name']) || id;
              if (!id && !title) return null;
              return {
                id: id || title,
                title: title || id,
                startPage: toNullableNumber(chapter.start_page ?? chapter.startPage),
                endPage: toNullableNumber(chapter.end_page ?? chapter.endPage),
              } satisfies StructureChapterSummary;
            })
            .filter((item): item is StructureChapterSummary => !!item);

          const chapterFiles = artifacts
            .filter((item) => /\/CH-\d+\/chapter_structure\.json$/i.test(item.relativePath))
            .slice(0, 20);
          const chapterTrees = await Promise.all(
            chapterFiles.map(async (item) => {
              const chapter = await readJsonRecord(item.relativePath);
              const chapterIdFromPath = item.relativePath.match(/\/(CH-\d+)\//i)?.[1] || '';
              const chapterId =
                pickString(chapter || {}, ['chapter_id', 'chapterId', 'cid', 'id']) || chapterIdFromPath;
              const chapterTitle = pickString(chapter || {}, ['chapter_title', 'title', 'name']) || chapterId;
              const rawSections = Array.isArray(chapter?.sections)
                ? chapter?.sections
                : Array.isArray(chapter?.items)
                  ? chapter?.items
                  : Array.isArray(chapter?.nodes)
                    ? chapter?.nodes
                    : [];
              const sections = rawSections
                .map((rawSection, index) => {
                  const section = asRecord(rawSection);
                  if (!section) return null;
                  const id =
                    pickString(section, ['section_id', 'sectionId', 'id', 'sid']) || `SEC-${index + 1}`;
                  const title = pickString(section, ['section_title', 'title', 'name']) || id;
                  return { id, title };
                })
                .filter((item): item is { id: string; title: string } => !!item);
              if (!chapterId && !chapterTitle && sections.length === 0) return null;
              return {
                chapterId: chapterId || chapterTitle || chapterIdFromPath || item.name,
                chapterTitle: chapterTitle || chapterId || chapterIdFromPath || item.name,
                sections,
              } satisfies StructureTreeNode;
            }),
          );
          const structureTree = chapterTrees.filter((item): item is StructureTreeNode => !!item);

          if (!cancelled) {
            setPhaseGuideExtra({
              structureChapters: chapters,
              structureTree,
              knowledgeReady: null,
              knowledgeBindingReady: null,
              assessmentCoverage: [],
              slideThumbnails: [],
              slideThumbnailOverflow: 0,
            });
          }
          return;
        }

        if (guidePhaseId === '04_knowledge') {
          const readyFile = artifacts.find((item) =>
            item.relativePath.toLowerCase().endsWith('/document_retrieval_ready.json'),
          );
          const bindingFile = artifacts.find((item) =>
            item.relativePath.toLowerCase().endsWith('/document_retrieval_binding_ready.json'),
          );

          const readReady = async (path: string): Promise<boolean | null> => {
            if (!path) return null;
            const parsed = await readJsonRecord(path);
            if (!parsed) return null;
            const explicitReady = parsed.ready;
            if (typeof explicitReady === 'boolean') return explicitReady;
            const status = pickString(parsed, ['status', 'state']).toLowerCase();
            if (!status) return true;
            if (['ok', 'ready', 'success', 'completed', 'complete'].includes(status)) return true;
            if (['error', 'failed', 'invalid'].includes(status)) return false;
            return true;
          };

          const [knowledgeReady, knowledgeBindingReady] = await Promise.all([
            readReady(readyFile?.relativePath || ''),
            readReady(bindingFile?.relativePath || ''),
          ]);
          if (!cancelled) {
            setPhaseGuideExtra({
              ...emptyPhaseGuideExtra(),
              knowledgeReady,
              knowledgeBindingReady,
            });
          }
          return;
        }

        if (guidePhaseId === '06_assessment') {
          const assessmentFiles = artifacts
            .filter(
              (item) =>
                item.phaseId === '06_assessment' &&
                (item.previewType === 'json' || item.relativePath.toLowerCase().endsWith('.json')),
            )
            .slice(0, 40);
          const totals = new Map<string, AssessmentCoverageCell>();

          await Promise.all(
            assessmentFiles.map(async (item) => {
              const parsed = await readJsonRecord(item.relativePath);
              const chapterFromPath = item.relativePath.match(/\/(CH-\d+)\//i)?.[1] || '';
              const chapterId = pickString(parsed || {}, ['chapter_id', 'chapterId']) || chapterFromPath || 'UNMAPPED';
              const chapterLabel = chapterId === 'UNMAPPED' ? 'Unmapped' : chapterId;
              const arraysToInspect = [
                parsed?.questions,
                parsed?.items,
                parsed?.question_bank,
                parsed?.question_set,
                parsed?.assessment_items,
                parsed?.problems,
              ];
              const questionCount =
                arraysToInspect.find((value) => Array.isArray(value))?.length ??
                (parsed ? 1 : 0);
              const current = totals.get(chapterId) || {
                chapterId,
                chapterLabel,
                questionCount: 0,
                fileCount: 0,
              };
              current.fileCount += 1;
              current.questionCount += questionCount;
              totals.set(chapterId, current);
            }),
          );

          const assessmentCoverage = Array.from(totals.values()).sort((a, b) =>
            a.chapterId.localeCompare(b.chapterId, undefined, { numeric: true, sensitivity: 'base' }),
          );
          if (!cancelled) {
            setPhaseGuideExtra({
              ...emptyPhaseGuideExtra(),
              assessmentCoverage,
            });
          }
          return;
        }

        const slideImageArtifacts = artifacts
          .filter(
            (item) =>
              item.phaseId === '07_slide' &&
              (item.previewType === 'image' ||
                /\.(png|jpg|jpeg|webp|gif)$/i.test(item.relativePath)),
          );
        const visibleSlideArtifacts = slideImageArtifacts.slice(0, 8);
        const slideThumbnails = (
          await Promise.all(
            visibleSlideArtifacts.map(async (item) => {
              const payload = await gateway.call('ontosynth.creation.artifacts.read', {
                relativePath: item.relativePath,
              });
              if (!payload || payload.status === 'error') return null;
              const record = asRecord(payload);
              const contentBase64 = typeof record?.content_base64 === 'string' ? record.content_base64 : '';
              if (!contentBase64) return null;
              const mime = typeof record?.mime === 'string' && record.mime ? record.mime : 'image/png';
              return {
                path: item.relativePath,
                name: item.name,
                dataUrl: `data:${mime};base64,${contentBase64}`,
              } satisfies SlideThumbnailItem;
            }),
          )
        ).filter((item): item is SlideThumbnailItem => !!item);
        if (!cancelled) {
          setPhaseGuideExtra({
            ...emptyPhaseGuideExtra(),
            slideThumbnails,
            slideThumbnailOverflow: Math.max(0, slideImageArtifacts.length - slideThumbnails.length),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPhaseGuideError(getErrorMessage(error, 'Failed to load phase guide data'));
          setPhaseGuideExtra(emptyPhaseGuideExtra());
        }
      } finally {
        if (!cancelled) setPhaseGuideLoading(false);
      }
    };
    void loadGuide();
    return () => {
      cancelled = true;
    };
  }, [workflowMode, connected, selectedApplicationId, guidePhaseId, artifacts]);

  useEffect(() => {
    if (selectedPhaseId !== '07_slide') return;
    if (artifactKind !== 'json' || !artifactText.trim()) return;
    const parsed = parseSlideIdentifiersFromJson(artifactText);
    if (!parsed.docId && !parsed.chapterId && !parsed.sectionId && !parsed.slideId) return;
    setSlideDocId((prev) => prev || parsed.docId);
    setSlideChapterId((prev) => prev || parsed.chapterId);
    setSlideSectionId((prev) => prev || parsed.sectionId);
    setSlideItemId((prev) => prev || parsed.slideId);
  }, [selectedPhaseId, artifactKind, artifactText]);

  useEffect(() => {
    if (!regenStatus.runId) return;
    if (!isStepRunActive(regenStatus.status)) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshStepRunStatus();
    };
    void tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [regenStatus.runId, regenStatus.status, refreshStepRunStatus]);

  if (workflowMode === 'intro') {
    return (
      <PageTransition className="p-6 max-w-[1380px] mx-auto h-full min-h-0 overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <section className="w-full max-w-5xl rounded-2xl border border-aegis-border bg-aegis-card p-6">
            <div className="text-center">
              <h1 className="text-[28px] font-semibold text-aegis-text">Course Creation Workflow</h1>
              <p className="mt-2 text-[13px] text-aegis-text-dim">Choose a branch to continue.</p>
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setWorkflowMode('create')}
                className="rounded-2xl border border-aegis-accent/20 bg-aegis-accent/[0.06] p-8 text-left hover:bg-aegis-accent/[0.12] transition-colors"
              >
                <p className="text-[20px] font-semibold text-aegis-text">Create Application</p>
                <p className="mt-2 text-[13px] text-aegis-text-dim">
                  Start a new application flow, define phases, and initialize outputs.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setWorkflowMode('edit')}
                className="rounded-2xl border border-aegis-primary/20 bg-aegis-primary/[0.06] p-8 text-left hover:bg-aegis-primary/[0.12] transition-colors"
              >
                <p className="text-[20px] font-semibold text-aegis-text">Edit Application</p>
                <p className="mt-2 text-[13px] text-aegis-text-dim">
                  Review generated files, edit JSON/images, and regenerate selected phases.
                </p>
              </button>
            </div>
            </section>
          </div>
      </PageTransition>
    );
  }

  if (workflowMode === 'create') {
    const resolvedCreateId = newApplicationId.trim() || toApplicationId(newApplicationName);
    const hasRequiredMaterials = selectedMaterialFiles.length > 0;
    const canCreateApplication =
      !!newApplicationName.trim() &&
      !!resolvedCreateId &&
      hasRequiredMaterials &&
      !creatingApplication;
    return (
      <PageTransition className="p-6 max-w-[1380px] mx-auto h-full min-h-0 overflow-hidden flex flex-col gap-4">
        <section className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)] gap-4">
            <div className="min-h-0 rounded-2xl border border-aegis-accent/15 bg-aegis-accent/[0.03] p-5 flex flex-col overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-[22px] font-semibold text-aegis-text">Create Application</h1>
                  <p className="mt-1 text-[12px] text-aegis-text-dim">
                    Bootstrap a new course application entry. Editing existing outputs is under Edit Application.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWorkflowMode('intro')}
                  className="px-3 py-1.5 text-[12px] rounded-lg border border-aegis-accent/30 bg-aegis-accent/[0.08] text-aegis-accent hover:bg-aegis-accent/[0.15]"
                >
                  Switch Branch
                </button>
              </div>

              <div className="mt-4 flex-1 min-h-0 overflow-auto pr-1 space-y-4">
              <div className="rounded-xl border border-aegis-accent/20 bg-aegis-card p-4 space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-aegis-text-dim">New Application Name</span>
                  <input
                    value={newApplicationName}
                    onChange={(event) => {
                      setNewApplicationName(event.target.value);
                      setCreateError('');
                      setCreateStatus('');
                    }}
                    placeholder="e.g. cfa_climate_risk_2026"
                    className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-3 py-2 text-[13px] text-aegis-text outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-aegis-text-dim">Application ID</span>
                  <input
                    value={newApplicationId}
                    onChange={(event) => {
                      setNewApplicationId(event.target.value);
                      setCreateError('');
                      setCreateStatus('');
                    }}
                    placeholder="auto from name if empty"
                    className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-3 py-2 text-[13px] text-aegis-text outline-none"
                  />
                  <span className="text-[11px] text-aegis-text-dim">Resolved ID: {resolvedCreateId || '-'}</span>
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] text-aegis-text-dim">Pipeline Template</span>
                    <select
                      value={pipelineTemplate}
                      onChange={(event) => setPipelineTemplate(event.target.value as PipelineTemplate)}
                      className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-3 py-2 text-[13px] text-aegis-text outline-none"
                    >
                      <option value="cfa">CFA baseline</option>
                      <option value="acca">ACCA baseline</option>
                      <option value="aec">AEC baseline</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] text-aegis-text-dim">Version</span>
                    <input
                      value={applicationVersion}
                      onChange={(event) => setApplicationVersion(event.target.value)}
                      placeholder="v2026"
                      className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-3 py-2 text-[13px] text-aegis-text outline-none"
                    />
                  </label>
                </div>
                <div className="rounded-md border border-aegis-primary/20 bg-aegis-primary/[0.04] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[12px] text-aegis-text-dim">Pipeline Phases & Detail Settings</p>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateGlobalTaskParamsRaw(JSON.stringify(DEFAULT_GLOBAL_TASK_PARAMS, null, 2));
                        setCreateGlobalTaskParamsError('');
                        setCreatePhaseSettingsRawById(buildInitialPhaseSettingsRawById());
                        setCreatePhaseSettingsErrorById({});
                      }}
                      className="ml-auto px-2 py-1 text-[10px] rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                    >
                      Reset Defaults
                    </button>
                  </div>
                  <p className="text-[11px] text-aegis-text-dim">
                    Textbook Generation is auto-enabled only when Raw Materials are uploaded. These settings map to OntoSynth TaskParams/phase params payload.
                  </p>
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.1fr)] gap-3">
                    <div className="rounded-md border border-aegis-primary/20 bg-aegis-card p-2 max-h-[420px] overflow-auto space-y-1">
                      <p className="px-1 text-[11px] text-aegis-text-dim">Enabled Phases</p>
                      {PIPELINE_PHASE_TEMPLATES.map((phase) => {
                        const textbookLocked = phase.id === '00_textbook' && rawMaterialPaths.length === 0;
                        const checked = textbookLocked ? false : !!createPhaseSelection[phase.id];
                        const active = activeCreatePhaseSettingsId === phase.id;
                        return (
                          <div
                            key={`create-phase-${phase.id}`}
                            className={clsx(
                              'inline-flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-[11px]',
                              active
                                ? 'border-aegis-primary/45 bg-aegis-primary/[0.12] text-aegis-primary'
                                : 'border-aegis-primary/20 bg-aegis-card text-aegis-text',
                              textbookLocked ? 'opacity-60' : '',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={textbookLocked}
                              onChange={(event) =>
                                setCreatePhaseSelection((prev) => ({ ...prev, [phase.id]: event.target.checked }))
                              }
                            />
                            <button
                              type="button"
                              onClick={() => setActiveCreatePhaseSettingsId(phase.id)}
                              className={clsx(
                                'flex-1 text-left',
                                active ? 'text-aegis-primary' : 'text-aegis-text',
                              )}
                            >
                              {phase.title}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-aegis-text-dim">Global Task Params (JSON)</span>
                        <textarea
                          value={createGlobalTaskParamsRaw}
                          onChange={(event) => {
                            setCreateGlobalTaskParamsRaw(event.target.value);
                            setCreateGlobalTaskParamsError('');
                          }}
                          className="w-full min-h-[90px] rounded-md border border-aegis-border bg-aegis-elevated px-2 py-2 text-[11px] text-aegis-text font-mono resize-y outline-none"
                          spellCheck={false}
                        />
                      </label>
                      {createGlobalTaskParamsError ? (
                        <p className="text-[11px] text-aegis-danger">Global params: {createGlobalTaskParamsError}</p>
                      ) : null}
                      <div className="rounded-md border border-aegis-border bg-aegis-card p-2">
                        {activeCreatePhaseSettingsId ? (
                          <>
                            <p className="text-[11px] text-aegis-text-dim mb-1">
                              {PIPELINE_PHASE_TEMPLATES.find((phase) => phase.id === activeCreatePhaseSettingsId)?.title || activeCreatePhaseSettingsId} Settings (JSON)
                            </p>
                            <textarea
                              value={activeCreatePhaseSettingsRaw}
                              onChange={(event) => {
                                const phaseId = activeCreatePhaseSettingsId;
                                setCreatePhaseSettingsRawById((prev) => ({ ...prev, [phaseId]: event.target.value }));
                                setCreatePhaseSettingsErrorById((prev) => ({ ...prev, [phaseId]: '' }));
                              }}
                              className="w-full min-h-[190px] rounded-md border border-aegis-border bg-aegis-elevated px-2 py-2 text-[11px] text-aegis-text font-mono resize-y outline-none"
                              spellCheck={false}
                            />
                            {activeCreatePhaseSettingsError ? (
                              <p className="mt-1 text-[11px] text-aegis-danger">Phase settings: {activeCreatePhaseSettingsError}</p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-[11px] text-aegis-text-dim">No phase selected.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] text-aegis-text-dim">Model/Policy Preset</span>
                    <select
                      value={modelPolicyPreset}
                      onChange={(event) => setModelPolicyPreset(event.target.value)}
                      className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-3 py-2 text-[13px] text-aegis-text outline-none"
                    >
                      <option value="strict_quality">Strict quality</option>
                      <option value="balanced">Balanced</option>
                      <option value="fast_draft">Fast draft</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] text-aegis-text-dim">Knowledge Schema Preset</span>
                    <select
                      value={knowledgeSchemaPreset}
                      onChange={(event) => setKnowledgeSchemaPreset(event.target.value)}
                      className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-3 py-2 text-[13px] text-aegis-text outline-none"
                    >
                      <option value="standard_esg">Standard ESG</option>
                      <option value="finance_heavy">Finance heavy</option>
                      <option value="education_focused">Education focused</option>
                    </select>
                  </label>
                </div>
                {createError && <p className="text-[11px] text-aegis-danger">{createError}</p>}
                {createStatus && <p className="text-[11px] text-aegis-text-dim">{createStatus}</p>}
              </div>

              <div className="rounded-xl border border-aegis-primary/20 bg-aegis-card p-4">
                <h2 className="text-[13px] font-medium text-aegis-text">Material Intake</h2>
                <p className="mt-1 text-[11px] text-aegis-text-dim">
                  Use two source cards to classify files. Source mode and initial source file are derived automatically.
                </p>
                <div className="mt-3 rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.04] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={clearMaterialFiles}
                      disabled={selectedMaterialFiles.length === 0}
                      className={clsx(
                        'px-2.5 py-1.5 text-[11px] rounded-md border',
                        selectedMaterialFiles.length === 0
                          ? 'border-aegis-border text-aegis-text-dim opacity-60 cursor-not-allowed'
                          : 'border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]',
                      )}
                    >
                      Clear All
                    </button>
                    <span className="ml-auto text-[11px] text-aegis-text-dim">
                      Selected {selectedMaterialFiles.length} · Official {officialMaterialPaths.length} · Raw {rawMaterialPaths.length} · Mode {sourceMode}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-md border border-aegis-accent/20 bg-aegis-card p-3 flex flex-col">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[12px] font-medium text-aegis-text">Official Textbook</h3>
                        <span className="text-[10px] text-aegis-text-dim">{officialMaterialItems.length} file(s)</span>
                        <button
                          type="button"
                          onClick={() => void selectMaterialFiles('official_textbook')}
                          className="ml-auto px-2 py-1 text-[11px] rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                        >
                          Add Files
                        </button>
                      </div>
                      <div className="mt-2 max-h-[210px] overflow-auto space-y-2 pr-1">
                        {officialMaterialItems.length === 0 ? (
                          <p className="text-[11px] text-aegis-text-dim">No files selected</p>
                        ) : (
                          officialMaterialItems.map((item) => (
                            <div key={item.path} className="rounded-md border border-aegis-border bg-aegis-elevated p-2">
                              <p className="text-[11px] text-aegis-text font-medium break-all">{fileNameFromPath(item.path)}</p>
                              <p className="mt-1 text-[10px] text-aegis-text-dim break-all">{item.path}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setMaterialBucket(item.path, 'raw_materials')}
                                  className="px-2 py-1 text-[10px] rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                                >
                                  Move to Raw
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeMaterialFile(item.path)}
                                  className="ml-auto px-2 py-1 text-[10px] rounded-md border border-aegis-border text-aegis-danger hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border border-aegis-warning/20 bg-aegis-card p-3 flex flex-col">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[12px] font-medium text-aegis-text">Raw Materials</h3>
                        <span className="text-[10px] text-aegis-text-dim">{rawMaterialItems.length} file(s)</span>
                        <button
                          type="button"
                          onClick={() => void selectMaterialFiles('raw_materials')}
                          className="ml-auto px-2 py-1 text-[11px] rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                        >
                          Add Files
                        </button>
                      </div>
                      <div className="mt-2 max-h-[210px] overflow-auto space-y-2 pr-1">
                        {rawMaterialItems.length === 0 ? (
                          <p className="text-[11px] text-aegis-text-dim">No files selected</p>
                        ) : (
                          rawMaterialItems.map((item) => (
                            <div key={item.path} className="rounded-md border border-aegis-border bg-aegis-elevated p-2">
                              <p className="text-[11px] text-aegis-text font-medium break-all">{fileNameFromPath(item.path)}</p>
                              <p className="mt-1 text-[10px] text-aegis-text-dim break-all">{item.path}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setMaterialBucket(item.path, 'official_textbook')}
                                  className="px-2 py-1 text-[10px] rounded-md border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                                >
                                  Move to Official
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeMaterialFile(item.path)}
                                  className="ml-auto px-2 py-1 text-[10px] rounded-md border border-aegis-border text-aegis-danger hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void createAndAttachApplication()}
                    disabled={!canCreateApplication}
                    className={clsx(
                      'px-3 py-1.5 text-[12px] rounded-lg text-white',
                      canCreateApplication ? 'bg-aegis-primary hover:opacity-90' : 'bg-aegis-text-dim opacity-60 cursor-not-allowed',
                    )}
                  >
                    {creatingApplication ? 'Creating...' : 'Create Application'}
                  </button>
                  {createdApplicationId && (
                    <button
                      type="button"
                      onClick={openCreatedApplicationInEdit}
                      className="px-3 py-1.5 text-[12px] rounded-lg border border-aegis-border text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                    >
                      Open in Edit Application
                    </button>
                  )}
                </div>
                {materialsError && <p className="mt-2 text-[11px] text-aegis-danger">{materialsError}</p>}
                {materialsStatus && <p className="mt-2 text-[11px] text-aegis-text-dim">{materialsStatus}</p>}
              </div>
              </div>
            </div>

            <aside className="min-h-0 rounded-2xl border border-aegis-primary/15 bg-aegis-primary/[0.03] p-4 overflow-auto">
              <h2 className="text-[14px] font-medium text-aegis-text">Creation Progress</h2>
              <p className="mt-1 text-[11px] text-aegis-text-dim">{createProgressMessage}</p>
              <div className="mt-3 h-1.5 rounded-full bg-aegis-card overflow-hidden">
                <div
                  className={clsx(
                    'h-full transition-[width] duration-300 ease-out',
                    createProgressSteps.some((item) => item.status === 'error')
                      ? 'bg-aegis-danger'
                      : createProgressSteps.some((item) => item.status === 'running')
                        ? 'bg-aegis-primary'
                        : 'bg-aegis-text-dim',
                  )}
                  style={{ width: `${Math.round((createProgressDoneCount / createProgressSteps.length) * 100)}%` }}
                />
              </div>
              <div className="mt-3 space-y-2">
                {createProgressSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className={clsx(
                      'rounded-md border px-3 py-2',
                      step.status === 'success'
                        ? 'border-aegis-success/25 bg-aegis-success/[0.06]'
                        : step.status === 'running'
                          ? 'border-aegis-primary/25 bg-aegis-primary/[0.08]'
                          : step.status === 'error'
                            ? 'border-aegis-danger/25 bg-aegis-danger/[0.06]'
                            : 'border-aegis-border bg-aegis-card',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          'h-2.5 w-2.5 rounded-full',
                          step.status === 'success'
                            ? 'bg-aegis-success'
                            : step.status === 'running'
                              ? 'bg-aegis-primary'
                              : step.status === 'error'
                                ? 'bg-aegis-danger'
                                : 'bg-aegis-text-dim',
                        )}
                      />
                      <p className="text-[12px] font-medium text-aegis-text">
                        {index + 1}. {step.title}
                      </p>
                      <span
                        className={clsx(
                          'ml-auto text-[10px] uppercase tracking-[0.04em]',
                          step.status === 'success'
                            ? 'text-aegis-success'
                            : step.status === 'running'
                              ? 'text-aegis-primary'
                              : step.status === 'error'
                                ? 'text-aegis-danger'
                                : 'text-aegis-text-dim',
                        )}
                      >
                        {step.status}
                      </span>
                    </div>
                    {step.detail ? (
                      <p className="mt-1 text-[11px] text-aegis-text-dim">{step.detail}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-aegis-text-dim">Waiting...</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-aegis-accent/20 bg-aegis-card p-3">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-aegis-text-dim">
                    Pipeline Progress
                  </p>
                  {createPipelineRunId ? (
                    <span className="ml-auto text-[10px] text-aegis-text-dim">run {createPipelineRunId}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-aegis-text-dim">
                  {createPipelineCurrentPhaseTitle
                    ? `Current phase: ${createPipelineCurrentPhaseTitle}`
                    : (createPipelineMessage || 'Pipeline not started')}
                </p>
                <div className="mt-2 space-y-1.5">
                  {createPipelinePhases.map((phase) => {
                    const hasReason = !!phase.reason;
                    const pinned = hasReason && pinnedPhaseReasonId === phase.id;
                    return (
                      <div
                        key={phase.id}
                        className={clsx(
                          'rounded-md border px-1.5 py-1',
                          phase.status === 'success'
                            ? 'border-aegis-success/25 bg-aegis-success/[0.05]'
                            : phase.status === 'running'
                              ? 'border-aegis-primary/25 bg-aegis-primary/[0.08]'
                              : phase.status === 'error' || phase.status === 'blocked'
                                ? 'border-aegis-danger/25 bg-aegis-danger/[0.06]'
                                : phase.status === 'not_applicable' || phase.status === 'unsupported'
                                  ? 'border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)]'
                                  : 'border-aegis-border bg-aegis-card',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={clsx(
                              'h-2 w-2 rounded-full',
                              phaseStatusDotClass(phase.status),
                            )}
                          />
                          <span className="text-[11px] text-aegis-text">{phase.title}</span>
                          {hasReason ? (
                            <button
                              type="button"
                              onClick={() => setPinnedPhaseReasonId((prev) => (prev === phase.id ? '' : phase.id))}
                              className={clsx(
                                'inline-flex items-center rounded text-aegis-text-dim hover:text-aegis-text',
                                pinned ? 'text-aegis-primary' : '',
                              )}
                              title={phase.reason}
                              aria-label={pinned ? `Hide reason for ${phase.title}` : `Pin reason for ${phase.title}`}
                            >
                              <CircleHelp className="h-3 w-3" />
                            </button>
                          ) : null}
                          <span
                            className={clsx(
                              'ml-auto text-[10px] uppercase tracking-[0.04em]',
                              phaseStatusTextClass(phase.status),
                            )}
                          >
                            {formatPhaseStatus(phase.status)}
                          </span>
                        </div>
                        {pinned ? (
                          <div className="mt-1 ml-4 max-h-[96px] overflow-auto rounded-md border border-aegis-border bg-aegis-elevated p-2 text-[10px] text-aegis-text-dim whitespace-pre-wrap break-words">
                            {phase.reason}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {createPipelineRunning ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => void cancelCreatePipeline()}
                      className="px-2.5 py-1 text-[11px] rounded-md border border-aegis-border text-aegis-danger hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                    >
                      Cancel Pipeline
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 rounded-lg border border-aegis-warning/20 bg-aegis-warning/[0.04] p-3">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-aegis-text-dim">
                    Pipeline Logs
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyPipelineSection(createPipelineLogTail, 'log')}
                    className="ml-auto px-2 py-1 text-[10px] rounded-md border border-aegis-border text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                  >
                    Copy
                  </button>
                </div>
                <pre className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-aegis-elevated p-2 text-[10px] text-aegis-text-dim">
                  {createPipelineLogTail || 'No logs yet.'}
                </pre>
                {copyLogStatus ? (
                  <p className="mt-1 text-[10px] text-aegis-text-dim">{copyLogStatus}</p>
                ) : null}
              </div>
              <div className="mt-3 rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.04] p-3">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-aegis-text-dim">
                    Runtime Debug
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyPipelineSection(createPipelineDebugText, 'debug')}
                    className="ml-auto px-2 py-1 text-[10px] rounded-md border border-aegis-border text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-aegis-text-dim">
                  Poll count: {createPipelinePollCount}
                </p>
                {createPipelineLastError ? (
                  <p className="mt-1 text-[10px] text-aegis-danger">
                    Last poll error: {createPipelineLastError}
                  </p>
                ) : null}
                <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-aegis-border bg-aegis-elevated p-2 text-[10px] text-aegis-text-dim">
                  {createPipelineDebugText || 'No debug payload yet.'}
                </pre>
                {copyDebugStatus ? (
                  <p className="mt-1 text-[10px] text-aegis-text-dim">{copyDebugStatus}</p>
                ) : null}
              </div>
              {createProgressUpdatedAt ? (
                <p className="mt-3 text-[10px] text-aegis-text-dim">
                  Last update: {new Date(createProgressUpdatedAt).toLocaleTimeString()}
                </p>
              ) : null}
              <div className="mt-4 rounded-lg border border-aegis-accent/20 bg-aegis-accent/[0.04] p-3">
                <p className="text-[11px] text-aegis-text-dim">Bridge Path</p>
                <p className="mt-1 text-[11px] text-aegis-text-dim">
                  Desktop UI -&gt; OpenClaw Gateway WS -&gt; OntoSynth plugin methods
                </p>
              </div>
            </aside>
          </div>
        </section>
      </PageTransition>
    );
  }

  return (
    <PageTransition className="p-6 max-w-[1380px] mx-auto h-full min-h-0 overflow-hidden flex flex-col gap-4">
      <section className="shrink-0 rounded-2xl border border-aegis-accent/20 bg-aegis-accent/[0.04] p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[220px]">
            <h1 className="text-[16px] font-semibold text-aegis-text">{flow.title}</h1>
            <p className="mt-1 text-[12px] text-aegis-text-dim">{flow.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setWorkflowMode('intro')}
            className="ml-auto px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-accent/30 bg-aegis-accent/[0.08] text-aegis-accent hover:bg-aegis-accent/[0.15]"
          >
            Switch Branch
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 xl:grid-cols-12 gap-3">
          <div className="xl:col-span-7 rounded-lg border border-aegis-accent/20 bg-aegis-accent/[0.04] p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-aegis-text-dim">Context</p>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-aegis-text-dim">Application</span>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedApplicationId}
                    onChange={(event) => {
                      setSelectedApplicationId(event.target.value);
                      setSaveStatus('');
                    }}
                    className="flex-1 min-w-0 rounded-md border border-aegis-border bg-aegis-card px-2 py-1.5 text-[12px] text-aegis-text outline-none"
                  >
                    {applications.length === 0 && <option value="default">Default</option>}
                    {applications.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void loadApplications()}
                    className="px-2 py-1.5 text-[11px] rounded-md border border-aegis-accent/30 bg-aegis-accent/[0.08] text-aegis-accent hover:bg-aegis-accent/[0.15]"
                    disabled={applicationsLoading}
                  >
                    {applicationsLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-aegis-text-dim">Document</span>
                <select
                  value={selectedDocumentName}
                  onChange={(event) => {
                    setSelectedDocumentName(event.target.value);
                    setSelectedArtifactPath('');
                    setArtifactStatus('');
                  }}
                  className="w-full rounded-md border border-aegis-border bg-aegis-card px-2 py-1.5 text-[12px] text-aegis-text outline-none"
                >
                  {documents.length === 0 && <option value="">No document</option>}
                  {documents.map((doc) => (
                    <option key={doc.name} value={doc.name}>
                      {doc.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-aegis-text-dim">Phase</span>
                <select
                  value={selectedPhaseId}
                  onChange={(event) => {
                    setSelectedPhaseId(event.target.value);
                    setSelectedArtifactPath('');
                    setArtifactStatus('');
                  }}
                  className="w-full rounded-md border border-aegis-border bg-aegis-card px-2 py-1.5 text-[12px] text-aegis-text outline-none"
                >
                  {phases.length === 0 && <option value="">All phases</option>}
                  {phases.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {applicationsError && <p className="mt-2 text-[11px] text-aegis-danger">{applicationsError}</p>}
          </div>

          <div className="xl:col-span-5 rounded-lg border border-aegis-primary/20 bg-aegis-primary/[0.05] p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-aegis-text-dim">Phase Actions</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadArtifacts()}
                className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-accent/30 bg-aegis-accent/[0.08] text-aegis-accent hover:bg-aegis-accent/[0.15]"
                disabled={artifactsLoading || !selectedDocumentName}
              >
                {artifactsLoading ? 'Loading Files...' : 'Refresh Files'}
              </button>
              <button
                type="button"
                onClick={() => void regeneratePhase()}
                className={clsx(
                  'px-2.5 py-1.5 text-[12px] rounded-lg text-white',
                  selectedPhase?.supportsRegenerate ? 'bg-aegis-primary shadow-[0_0_0_1px_rgba(var(--aegis-primary),0.35)] hover:opacity-90' : 'bg-aegis-text-dim opacity-60 cursor-not-allowed',
                )}
                disabled={!selectedPhase?.supportsRegenerate || stepRunActive}
              >
                {stepRunActive && regenStatus.mode === 'phase' ? 'Running...' : 'Run Phase'}
              </button>
              {stepRunActive ? (
                <button
                  type="button"
                  onClick={() => void cancelPhaseOrSlideRun()}
                  className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-danger/35 bg-aegis-danger/[0.07] text-aegis-danger hover:bg-aegis-danger/[0.13]"
                >
                  Cancel Run
                </button>
              ) : null}
              <button
                type="button"
                onClick={resetRunState}
                className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-warning/30 bg-aegis-warning/[0.08] text-aegis-warning hover:bg-aegis-warning/[0.15] inline-flex items-center gap-1.5"
              >
                <RefreshCw size={12} />
                Restart Steps
              </button>
            </div>
            {selectedPhaseId === '07_slide' ? (
              <div className="mt-3 rounded-md border border-aegis-primary/25 bg-aegis-primary/[0.08] p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-aegis-text-dim">Slide Regeneration</p>
                  <button
                    type="button"
                    onClick={populateSlideIdsFromArtifact}
                    className="ml-auto px-2 py-1 text-[10px] rounded-md border border-aegis-accent/30 bg-aegis-accent/[0.1] text-aegis-accent hover:bg-aegis-accent/[0.16]"
                  >
                    Use IDs from JSON
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={slideDocId}
                    onChange={(event) => setSlideDocId(event.target.value)}
                    placeholder="docId"
                    className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-2 py-1.5 text-[11px] text-aegis-text outline-none"
                  />
                  <input
                    value={slideChapterId}
                    onChange={(event) => setSlideChapterId(event.target.value)}
                    placeholder="chapterId"
                    className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-2 py-1.5 text-[11px] text-aegis-text outline-none"
                  />
                  <input
                    value={slideSectionId}
                    onChange={(event) => setSlideSectionId(event.target.value)}
                    placeholder="sectionId"
                    className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-2 py-1.5 text-[11px] text-aegis-text outline-none"
                  />
                  <input
                    value={slideItemId}
                    onChange={(event) => setSlideItemId(event.target.value)}
                    placeholder="slideId"
                    className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-2 py-1.5 text-[11px] text-aegis-text outline-none"
                  />
                </div>
                <input
                  value={slideRevisionNote}
                  onChange={(event) => setSlideRevisionNote(event.target.value)}
                  placeholder="Revision note (optional)"
                  className="w-full rounded-md border border-aegis-border bg-aegis-elevated px-2 py-1.5 text-[11px] text-aegis-text outline-none"
                />
                <button
                  type="button"
                  onClick={() => void regenerateSlide()}
                  disabled={!slideActionEnabled || stepRunActive}
                  className={clsx(
                    'px-2.5 py-1.5 text-[11px] rounded-md text-white',
                    slideActionEnabled && !stepRunActive
                      ? 'bg-aegis-primary shadow-[0_0_0_1px_rgba(var(--aegis-primary),0.35)] hover:opacity-90'
                      : 'bg-aegis-text-dim opacity-60 cursor-not-allowed',
                  )}
                >
                  {stepRunActive && regenStatus.mode === 'slide' ? 'Running Slide...' : 'Regenerate Slide'}
                </button>
              </div>
            ) : null}
            {artifactsError && <p className="mt-2 text-[11px] text-aegis-danger">{artifactsError}</p>}
            {(regenStatus.runId || regenStatus.message) ? (
              <div className="mt-2 rounded-md border border-aegis-accent/25 bg-aegis-accent/[0.06] p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx('rounded px-1.5 py-0.5 text-[10px] border',
                    regenStatus.status === 'error'
                      ? 'border-aegis-danger/35 text-aegis-danger'
                      : stepRunActive
                        ? 'border-aegis-primary/35 text-aegis-primary'
                        : 'border-aegis-success/35 text-aegis-success'
                  )}>
                    {regenStatus.status || 'idle'}
                  </span>
                  {regenStatus.runId ? <span className="text-[10px] text-aegis-text-dim">run {regenStatus.runId}</span> : null}
                  <span className="text-[10px] text-aegis-text-dim">polls {stepPollCount}</span>
                  <span className="text-[10px] text-aegis-text-dim">
                    {stepLastUpdateAt ? `last ${new Date(stepLastUpdateAt).toLocaleTimeString()}` : 'last n/a'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshStepRunStatus()}
                    disabled={!regenStatus.runId}
                    className={clsx(
                      'ml-auto px-2 py-1 text-[10px] rounded-md border',
                      regenStatus.runId
                        ? 'border-aegis-accent/30 bg-aegis-accent/[0.1] text-aegis-accent hover:bg-aegis-accent/[0.16]'
                        : 'border-aegis-border text-aegis-text-dim opacity-60 cursor-not-allowed',
                    )}
                  >
                    Refresh Status
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyStepLogs()}
                    className="px-2 py-1 text-[10px] rounded-md border border-aegis-accent/30 bg-aegis-accent/[0.1] text-aegis-accent hover:bg-aegis-accent/[0.16]"
                  >
                    Copy Logs
                  </button>
                </div>
                {regenStatus.message ? (
                  <p className={clsx('mt-1 text-[11px]', regenStatus.status === 'error' ? 'text-aegis-danger' : 'text-aegis-text-dim')}>
                    {regenStatus.message}
                  </p>
                ) : null}
                {stepLastPollError ? (
                  <p className="mt-1 text-[11px] text-aegis-danger">poll error: {stepLastPollError}</p>
                ) : null}
                {stepLogCopyStatus ? (
                  <p className="mt-1 text-[10px] text-aegis-text-dim">{stepLogCopyStatus}</p>
                ) : null}
                <div className="mt-2 rounded border border-aegis-border bg-aegis-card px-2 py-1">
                  <p className="text-[10px] uppercase tracking-[0.04em] text-aegis-text-dim">Run Logs</p>
                  <pre className="mt-1 max-h-[120px] overflow-auto text-[11px] text-aegis-text whitespace-pre-wrap">
                    {regenStatus.logTail || 'No logs yet. Waiting for process output...'}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        </div>

      </section>

      <section className="flex-1 min-h-0 rounded-2xl border border-aegis-primary/15 bg-aegis-primary/[0.03] p-4 overflow-hidden">
        <div className="h-full min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] gap-4">
          <div className="min-h-0 flex flex-col">
            <div className="shrink-0">
              <div className="flex items-center justify-between text-[12px] text-aegis-text-dim">
                <span>{completed ? 'Completed' : `Step ${currentStepIndex + 1} / ${flow.steps.length}`}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-aegis-elevated overflow-hidden">
                <div
                  className="h-full bg-aegis-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 mt-4 rounded-xl border border-aegis-accent/20 bg-aegis-accent/[0.04] p-4 overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-hidden">
                <AnimatePresence initial={false} mode="wait">
                  {completed ? (
                    <motion.div
                      key="flow-complete"
                      className="h-full flex flex-col items-center justify-center text-center"
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -24 }}
                      transition={{ duration: 0.22 }}
                    >
                      <h2 className="text-[24px] font-semibold text-aegis-text">All Steps Confirmed</h2>
                      <p className="mt-2 text-[13px] text-aegis-text-dim">You can restart or load a new JSON flow.</p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={currentStep.id}
                      className="h-full overflow-auto pr-2"
                      initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
                      transition={{ duration: 0.22 }}
                    >
                      {phaseGuide ? (
                        <div className="mb-4 rounded-xl border border-aegis-accent/25 bg-aegis-accent/[0.06] p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12px] font-semibold text-aegis-text">Step Focus · {phaseGuide.title}</p>
                            <span className={clsx('ml-auto rounded-md border px-2 py-0.5 text-[10px]', toneClass((guidePhase?.present ?? false) ? 'success' : 'warning'))}>
                              {(guidePhase?.present ?? false) ? 'Outputs present' : 'No outputs yet'}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-aegis-text-dim">{phaseGuide.objective}</p>
                          <div className="mt-2 grid grid-cols-2 lg:grid-cols-3 gap-2">
                            {phaseGuide.stats.map((stat) => (
                              <div key={`${phaseGuide.phaseId}-${stat.label}`} className={clsx('rounded-md border px-2 py-1', toneClass(stat.tone))}>
                                <p className="text-[10px] uppercase tracking-[0.04em]">{stat.label}</p>
                                <p className="text-[12px] font-semibold mt-0.5">{stat.value}</p>
                              </div>
                            ))}
                          </div>
                          {phaseGuide.chapters.length > 0 ? (
                            <div className="mt-2 rounded-md border border-aegis-border bg-aegis-card px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.04em] text-aegis-text-dim">Chapters</p>
                              <div className="mt-1 space-y-1 max-h-[120px] overflow-auto pr-1">
                                {phaseGuide.chapters.map((chapter) => (
                                  <div key={chapter.id} className="flex items-center gap-2 text-[11px] text-aegis-text-dim">
                                    <span className="rounded border border-aegis-border px-1 py-0.5 text-[10px] text-aegis-text">{chapter.id}</span>
                                    <span className="flex-1 truncate">{chapter.title}</span>
                                    <span className="font-mono text-[10px]">
                                      {chapter.startPage != null && chapter.endPage != null
                                        ? `${chapter.startPage}-${chapter.endPage}`
                                        : 'n/a'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {phaseGuide.structureTree.length > 0 ? (
                            <div className="mt-2 rounded-md border border-aegis-primary/25 bg-aegis-primary/[0.06] px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.04em] text-aegis-primary">Structure Tree</p>
                              <div className="mt-1 max-h-[180px] overflow-auto pr-1 space-y-1.5">
                                {phaseGuide.structureTree.map((node) => (
                                  <div key={node.chapterId} className="rounded border border-aegis-primary/20 bg-aegis-card px-2 py-1">
                                    <div className="flex items-center gap-2 text-[10px]">
                                      <span className="rounded border border-aegis-border px-1 py-0.5 font-mono text-aegis-text">{node.chapterId}</span>
                                      <span className="truncate text-aegis-text">{node.chapterTitle}</span>
                                      <span className="ml-auto text-aegis-text-dim">{node.sections.length} sections</span>
                                    </div>
                                    {node.sections.length > 0 ? (
                                      <div className="mt-1 space-y-1">
                                        {node.sections.slice(0, 6).map((section) => (
                                          <div key={`${node.chapterId}-${section.id}`} className="flex items-center gap-2 text-[10px] text-aegis-text-dim">
                                            <span className="rounded border border-aegis-border px-1 py-0.5 font-mono">{section.id}</span>
                                            <span className="truncate">{section.title}</span>
                                          </div>
                                        ))}
                                        {node.sections.length > 6 ? (
                                          <p className="text-[10px] text-aegis-text-dim">+{node.sections.length - 6} more sections</p>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {guidePhaseId === '02_structure' && !phaseGuideLoading && phaseGuide.structureTree.length === 0 ? (
                            <p className="mt-2 text-[10px] text-aegis-text-dim">No chapter structure tree files detected yet.</p>
                          ) : null}
                          {phaseGuide.assessmentCoverage.length > 0 ? (
                            <div className="mt-2 rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.08] px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.04em] text-aegis-warning">Assessment Coverage Heatmap</p>
                              <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                {(() => {
                                  const maxQuestionCount = phaseGuide.assessmentCoverage.reduce(
                                    (max, row) => Math.max(max, row.questionCount),
                                    0,
                                  );
                                  return phaseGuide.assessmentCoverage.map((row) => {
                                    const intensity = maxQuestionCount > 0 ? row.questionCount / maxQuestionCount : 0;
                                    return (
                                      <div
                                        key={row.chapterId}
                                        className="rounded border border-aegis-warning/30 px-2 py-1 text-[10px]"
                                        style={{ backgroundColor: `rgba(234, 179, 8, ${0.12 + intensity * 0.38})` }}
                                      >
                                        <p className="font-semibold text-aegis-text">{row.chapterLabel}</p>
                                        <p className="text-aegis-text-dim">{row.questionCount} questions</p>
                                        <p className="text-aegis-text-dim">{row.fileCount} files</p>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          ) : null}
                          {guidePhaseId === '06_assessment' && !phaseGuideLoading && phaseGuide.assessmentCoverage.length === 0 ? (
                            <p className="mt-2 text-[10px] text-aegis-text-dim">No assessment coverage data detected yet.</p>
                          ) : null}
                          {phaseGuide.slideThumbnails.length > 0 ? (
                            <div className="mt-2 rounded-md border border-aegis-success/25 bg-aegis-success/[0.08] px-2 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.04em] text-aegis-success">Slide Thumbnails</p>
                              <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
                                {phaseGuide.slideThumbnails.map((thumb) => (
                                  <button
                                    key={thumb.path}
                                    type="button"
                                    onClick={() => {
                                      setSelectedArtifactPath(thumb.path);
                                      setArtifactStatus('');
                                    }}
                                    className="group shrink-0 w-[120px] rounded border border-aegis-success/30 bg-aegis-card p-1 text-left hover:border-aegis-success/50"
                                    title={thumb.path}
                                  >
                                    <img src={thumb.dataUrl} alt={thumb.name} className="h-[72px] w-full rounded object-cover" />
                                    <p className="mt-1 truncate text-[10px] text-aegis-text-dim group-hover:text-aegis-text">{thumb.name}</p>
                                  </button>
                                ))}
                              </div>
                              {phaseGuide.slideThumbnailOverflow > 0 ? (
                                <p className="text-[10px] text-aegis-text-dim">+{phaseGuide.slideThumbnailOverflow} more slide images available</p>
                              ) : null}
                            </div>
                          ) : null}
                          {guidePhaseId === '07_slide' && !phaseGuideLoading && phaseGuide.slideThumbnails.length === 0 ? (
                            <p className="mt-2 text-[10px] text-aegis-text-dim">No slide images detected yet.</p>
                          ) : null}
                          {phaseGuide.keyFiles.length > 0 ? (
                            <div className="mt-2">
                              <p className="text-[10px] uppercase tracking-[0.04em] text-aegis-text-dim">Key Files</p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {phaseGuide.keyFiles.map((file) => (
                                  <button
                                    key={file.path}
                                    type="button"
                                    onClick={() => {
                                      setSelectedArtifactPath(file.path);
                                      setArtifactStatus('');
                                    }}
                                    className="px-2 py-1 text-[10px] rounded-md border border-aegis-accent/30 bg-aegis-accent/[0.1] text-aegis-accent hover:bg-aegis-accent/[0.16]"
                                    title={file.path}
                                  >
                                    {file.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                            {phaseGuide.actions.map((action, idx) => (
                              <p key={`${phaseGuide.phaseId}-action-${idx}`} className="text-[10px] text-aegis-text-dim">
                                {idx + 1}. {action}
                              </p>
                            ))}
                          </div>
                          {phaseGuideLoading ? (
                            <p className="mt-1 text-[10px] text-aegis-text-dim">Loading phase details...</p>
                          ) : null}
                          {phaseGuideError ? (
                            <p className="mt-1 text-[10px] text-aegis-danger">{phaseGuideError}</p>
                          ) : null}
                        </div>
                      ) : null}
                      <h2 className="text-[22px] font-semibold text-aegis-text">{currentStep.title}</h2>
                      <p className="mt-3 text-[14px] text-aegis-text whitespace-pre-wrap leading-6">{currentStep.content}</p>
                      {currentStep.bullets.length > 0 && (
                        <ul className="mt-4 space-y-2 text-[13px] text-aegis-text-dim">
                          {currentStep.bullets.map((bullet, index) => (
                            <li key={`${currentStep.id}-bullet-${index}`} className="flex items-start gap-2">
                              <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-aegis-primary shrink-0" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="mt-3 shrink-0 border-t border-aegis-border pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  {!completed && needsConfirm && (
                    <label className="flex items-center gap-2 text-[13px] text-aegis-text">
                      <input
                        type="checkbox"
                        checked={currentConfirmed}
                        onChange={(event) => {
                          setConfirmByStepId((prev) => ({ ...prev, [currentStep.id]: event.target.checked }));
                        }}
                      />
                      {currentStep.confirmText}
                    </label>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditorOpen((v) => !v)}
                      className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-accent/30 bg-aegis-accent/[0.08] text-aegis-accent hover:bg-aegis-accent/[0.15]"
                    >
                      {editorOpen ? 'Hide JSON' : 'Edit JSON'}
                    </button>
                    <button
                      type="button"
                      onClick={onBack}
                      disabled={!completed && currentStepIndex === 0}
                      className={clsx(
                        'px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-border',
                        !completed && currentStepIndex === 0
                          ? 'text-aegis-text-dim opacity-50 cursor-not-allowed'
                          : 'border-aegis-warning/30 bg-aegis-warning/[0.07] text-aegis-warning hover:bg-aegis-warning/[0.13]',
                      )}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={onSave}
                      className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-success/30 bg-aegis-success/[0.08] text-aegis-success hover:bg-aegis-success/[0.14]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={onContinue}
                      disabled={continueDisabled}
                      className={clsx(
                        'px-2.5 py-1.5 text-[12px] rounded-lg text-white',
                        continueDisabled ? 'bg-aegis-text-dim opacity-60 cursor-not-allowed' : 'bg-aegis-primary hover:opacity-90',
                      )}
                    >
                      {currentStepIndex >= flow.steps.length - 1 ? 'Finish' : 'Continue'}
                    </button>
                  </div>
                </div>
                {editorOpen && (
                  <div className="mt-3 rounded-lg border border-aegis-accent/20 bg-aegis-card p-2.5">
                    <textarea
                      value={rawJson}
                      onChange={(event) => {
                        setRawJson(event.target.value);
                        setSaveStatus('');
                      }}
                      className="w-full min-h-[140px] rounded-lg border border-aegis-border bg-aegis-elevated p-3 text-[12px] text-aegis-text font-mono resize-y"
                      spellCheck={false}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={applyJson}
                        className="px-2.5 py-1.5 text-[12px] rounded-lg bg-aegis-primary text-white hover:opacity-90"
                      >
                        Load JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRawJson(SAMPLE_FLOW_JSON);
                          setJsonError('');
                          setSaveStatus('');
                        }}
                        className="px-2.5 py-1.5 text-[12px] rounded-lg border border-aegis-warning/30 bg-aegis-warning/[0.08] text-aegis-warning hover:bg-aegis-warning/[0.15]"
                      >
                        Use Sample
                      </button>
                    </div>
                    {jsonError && <div className="mt-2 text-[12px] text-aegis-danger">{jsonError}</div>}
                  </div>
                )}
                {saveStatus && <p className="mt-2 text-[11px] text-aegis-text-dim">{saveStatus}</p>}
              </div>
            </div>
          </div>

          <div className="min-h-0 rounded-xl border border-aegis-primary/20 bg-aegis-primary/[0.04] p-3 flex flex-col">
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-aegis-text-dim">Generated Content</span>
              <select
                value={selectedArtifactPath}
                onChange={(event) => {
                  setSelectedArtifactPath(event.target.value);
                  setArtifactStatus('');
                }}
                className="flex-1 min-w-[220px] bg-aegis-card border border-aegis-primary/20 rounded-md px-2 py-1 text-[12px] text-aegis-text outline-none"
              >
                {artifacts.length === 0 && <option value="">{artifactsLoading ? 'Loading...' : 'No files'}</option>}
                {artifacts.map((artifact) => (
                  <option key={artifact.relativePath} value={artifact.relativePath}>
                    {artifact.phaseId} · {artifact.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void saveArtifact()}
                disabled={!artifactDirty || !(artifactKind === 'json' || artifactKind === 'text') || !selectedArtifact?.editable}
                className={clsx(
                  'px-2.5 py-1.5 text-[12px] rounded-lg border',
                  !artifactDirty || !(artifactKind === 'json' || artifactKind === 'text') || !selectedArtifact?.editable
                    ? 'border-aegis-border text-aegis-text-dim opacity-60 cursor-not-allowed'
                    : 'border-aegis-success/30 bg-aegis-success/[0.08] text-aegis-success hover:bg-aegis-success/[0.14]',
                )}
              >
                Save File
              </button>
            </div>
            {selectedArtifact && (
              <p className="mt-1 text-[11px] text-aegis-text-dim break-all">{selectedArtifact.relativePath}</p>
            )}
            {selectedArtifact && !selectedArtifact.editable && (
              <p className="mt-1 text-[11px] text-aegis-warning">This artifact is read-only.</p>
            )}
            {artifactStatus && <p className="mt-1 text-[11px] text-aegis-text-dim">{artifactStatus}</p>}
            {regenStatus.logTail && (
              <details className="mt-2 rounded border border-aegis-accent/25 bg-aegis-accent/[0.06] px-2 py-1">
                <summary className="text-[11px] text-aegis-text-dim cursor-pointer">Run log</summary>
                <pre className="mt-2 max-h-[120px] overflow-auto text-[11px] text-aegis-text whitespace-pre-wrap">{regenStatus.logTail}</pre>
              </details>
            )}

            <div className="mt-3 flex-1 min-h-0 rounded-lg border border-aegis-primary/20 bg-aegis-card overflow-hidden">
              {artifactReadLoading ? (
                <div className="h-full flex items-center justify-center text-[12px] text-aegis-text-dim">Loading file...</div>
              ) : artifactKind === 'image' && artifactDataUrl ? (
                <div className="h-full overflow-auto p-2">
                  <img src={artifactDataUrl} alt={selectedArtifact?.name || 'artifact'} className="max-w-full h-auto rounded-md" />
                </div>
              ) : artifactKind === 'json' || artifactKind === 'text' ? (
                <textarea
                  value={artifactText}
                  onChange={(event) => {
                    if (!selectedArtifact?.editable) return;
                    setArtifactText(event.target.value);
                    setArtifactDirty(true);
                    setArtifactStatus('');
                  }}
                  readOnly={!selectedArtifact?.editable}
                  className="w-full h-full bg-transparent p-3 text-[12px] text-aegis-text font-mono resize-none outline-none"
                  spellCheck={false}
                />
              ) : selectedArtifactPath ? (
                <div className="h-full flex items-center justify-center text-[12px] text-aegis-text-dim">
                  {artifactMime ? `Preview not available (${artifactMime})` : 'Preview not available'}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[12px] text-aegis-text-dim">
                  Select a generated file to view or edit.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
