# Social Studio Playbook IA v1

## Goal
Adapt Social Studio to an operations-first workflow inspired by `xiaohongshu-skills`, without cloning all skills one-by-one.

## Information Architecture

### Global Frame
1. Header: workspace, health, refresh, settings
2. Playbook Center (new): select sector -> select playbook -> fill structured inputs -> apply to draft builder
3. Draft Builder (existing): brief/models/advanced controls/generate/poster/publish
4. Settings Modal (existing): accounts + OAuth + model settings

### Sector Model (8 modules)
1. `01 Content Creation`
2. `02 Account Operations`
3. `03 Engagement Ops`
4. `04 Data Analytics` (mapped from source `03-数据分析`)
5. `05 Commerce Conversion`
6. `06 Platform Rules`
7. `07 Tool Ecosystem`
8. `08 Marketing & Growth` (combined source `07-营销推广` + `08-增长策略`)

## MVP Playbooks (v1)
1. Content Production Sprint
2. Account Positioning Workshop
3. Engagement Reply Engine
4. Weekly Analytics Review
5. Commerce Conversion Funnel
6. Compliance Precheck Guard
7. Tool Ecosystem SOP
8. Marketing & Growth Sprint

Each playbook provides:
1. Objective and KPI
2. Structured fields (not blank free-form prompting)
3. Generated brief preview
4. Related skill references
5. `Apply to Draft Builder` action

## Screen-Level Flow

### Flow A: Build Draft from Playbook
1. User picks a sector.
2. User picks a playbook in that sector.
3. User fills 3-4 structured fields.
4. UI renders brief/context preview.
5. User clicks `Apply to Draft Builder`.
6. Draft builder auto-populates brief/topic/angle/tone/audience/cta/platforms.
7. User clicks `Generate` and optionally `Generate Poster`.

### Flow B: Policy-Safe Publishing
1. User picks `Compliance Precheck Guard`.
2. User fills risky claims/terms.
3. User applies playbook to draft builder.
4. User generates policy-safe rewrite.
5. User publishes only if output is publishable.

### Flow C: Ops Planning
1. User picks `Account Positioning Workshop` or `Tool Ecosystem SOP`.
2. User generates plan-style draft.
3. User uses output as weekly execution checklist.

## Why this design
1. Keeps user cognitive load lower than 139 skill pages.
2. Preserves quality from skill system via structured prompts and skill mapping.
3. Reuses existing generation/publishing pipeline with minimal backend churn.

## Phase 2 Implemented
1. Workspace-scoped playbook run history (local persistence).
2. One-click `Apply + Generate` action in Playbook Center.
3. KPI tracking per playbook: apply count, generate success/attempts, brief-output count, poster success, queue success, and publish success.

## Next Phase (v2)
1. Upgrade playbook history persistence from local storage to backend (shared across desktop sessions).
2. Add playbook-specific output renderer (tables/checklists/cards).
3. Add analytics hooks to score playbook outcomes by KPI.
4. Add role-based playbooks (founder/operator/brand manager).
