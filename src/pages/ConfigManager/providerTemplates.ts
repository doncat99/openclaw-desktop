// ═══════════════════════════════════════════════════════════
// Provider Templates — Config Manager Phase 2
// Complete list of supported AI providers in OpenClaw
// ═══════════════════════════════════════════════════════════

export interface ProviderTemplate {
  id: string;
  nameKey: string;
  name: string;                    // display name (fallback when i18n not loaded)
  icon: string;                    // single letter or emoji
  colorClass: string;              // Tailwind gradient classes
  authModes: string[];             // ["token", "api_key", "oauth"]
  defaultAuthMode: string;
  envKey: string;                  // primary env var
  envKeyAlt?: string[];            // alternative env var names
  baseUrl?: string;                // for custom / local providers
  api?: string;                    // "openai-completions" | "anthropic"
  popularModels: { id: string; suggestedAlias?: string }[];
  docsUrl?: string;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  // ── 1. Anthropic ─────────────────────────────────────────
  {
    id: 'anthropic',
    nameKey: 'config.provider.anthropic',
    name: 'Anthropic',
    icon: 'A',
    colorClass: 'from-amber-600 to-yellow-700',
    authModes: ['token', 'api_key'],
    defaultAuthMode: 'token',
    envKey: 'ANTHROPIC_API_KEY',
    envKeyAlt: ['ANTHROPIC_API_KEYS', 'ANTHROPIC_API_KEY_1'],
    api: 'anthropic',
    popularModels: [
      { id: 'anthropic/claude-opus-4-6',    suggestedAlias: 'opus'     },
      { id: 'anthropic/claude-sonnet-4-6',  suggestedAlias: 'sonnet46' },
      { id: 'anthropic/claude-sonnet-4-5',  suggestedAlias: 'sonnet'   },
      { id: 'anthropic/claude-haiku-3.5',   suggestedAlias: 'haiku'    },
    ],
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
  },

  // ── 2. OpenAI ─────────────────────────────────────────────
  {
    id: 'openai',
    nameKey: 'config.provider.openai',
    name: 'OpenAI',
    icon: 'O',
    colorClass: 'from-emerald-600 to-green-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'OPENAI_API_KEY',
    envKeyAlt: ['OPENAI_API_KEYS'],
    api: 'openai-completions',
    popularModels: [
      { id: 'openai/gpt-5.2',       suggestedAlias: 'gpt'      },
      { id: 'openai/gpt-5-mini',    suggestedAlias: 'gpt-mini' },
      { id: 'openai/gpt-5.1-codex', suggestedAlias: 'codex'    },
    ],
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },

  // ── 3. Google Gemini ──────────────────────────────────────
  {
    id: 'google',
    nameKey: 'config.provider.google',
    name: 'Google Gemini',
    icon: 'G',
    colorClass: 'from-blue-600 to-blue-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'GEMINI_API_KEY',
    envKeyAlt: ['GOOGLE_API_KEY'],
    api: 'openai-completions',
    popularModels: [
      { id: 'google/gemini-3-pro-preview',   suggestedAlias: 'gemini'       },
      { id: 'google/gemini-3-flash-preview', suggestedAlias: 'gemini-flash' },
    ],
    docsUrl: 'https://ai.google.dev/api',
  },

  // ── 4. Mistral ────────────────────────────────────────────
  {
    id: 'mistral',
    nameKey: 'config.provider.mistral',
    name: 'Mistral',
    icon: 'M',
    colorClass: 'from-orange-500 to-red-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'MISTRAL_API_KEY',
    api: 'openai-completions',
    popularModels: [
      { id: 'mistral/mistral-large-latest', suggestedAlias: 'mistral' },
      { id: 'mistral/codestral-latest',     suggestedAlias: 'codestral' },
    ],
    docsUrl: 'https://docs.mistral.ai/api/',
  },

  // ── 5. xAI (Grok) ────────────────────────────────────────
  {
    id: 'xai',
    nameKey: 'config.provider.xai',
    name: 'xAI',
    icon: 'X',
    colorClass: 'from-slate-600 to-gray-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'XAI_API_KEY',
    api: 'openai-completions',
    popularModels: [
      { id: 'xai/grok-3', suggestedAlias: 'grok' },
    ],
    docsUrl: 'https://docs.x.ai/api',
  },

  // ── 6. Groq ──────────────────────────────────────────────
  {
    id: 'groq',
    nameKey: 'config.provider.groq',
    name: 'Groq',
    icon: 'G',
    colorClass: 'from-violet-600 to-purple-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'GROQ_API_KEY',
    api: 'openai-completions',
    popularModels: [
      { id: 'groq/llama-4-maverick', suggestedAlias: 'llama' },
    ],
    docsUrl: 'https://console.groq.com/docs',
  },

  // ── 7. OpenRouter ─────────────────────────────────────────
  {
    id: 'openrouter',
    nameKey: 'config.provider.openrouter',
    name: 'OpenRouter',
    icon: 'R',
    colorClass: 'from-pink-600 to-rose-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    popularModels: [
      { id: 'openrouter/anthropic/claude-sonnet-4-5', suggestedAlias: 'sonnet' },
      { id: 'openrouter/google/gemini-3-pro-preview',  suggestedAlias: 'gemini' },
    ],
    docsUrl: 'https://openrouter.ai/docs',
  },

  // ── 8. DeepSeek ───────────────────────────────────────────
  {
    id: 'deepseek',
    nameKey: 'config.provider.deepseek',
    name: 'DeepSeek',
    icon: 'D',
    colorClass: 'from-cyan-600 to-teal-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions',
    popularModels: [
      { id: 'deepseek/deepseek-r1',   suggestedAlias: 'deepseek-r1'   },
      { id: 'deepseek/deepseek-chat', suggestedAlias: 'deepseek-chat' },
    ],
    docsUrl: 'https://api-docs.deepseek.com/',
  },

  // ── 9. NVIDIA ─────────────────────────────────────────────
  {
    id: 'nvidia',
    nameKey: 'config.provider.nvidia',
    name: 'NVIDIA',
    icon: 'N',
    colorClass: 'from-green-600 to-lime-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'NVIDIA_API_KEY',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    api: 'openai-completions',
    popularModels: [],
    docsUrl: 'https://docs.api.nvidia.com/',
  },

  // ── 10. Z.AI (GLM) ────────────────────────────────────────
  {
    id: 'zai',
    nameKey: 'config.provider.zai',
    name: 'Z.AI (GLM)',
    icon: 'Z',
    colorClass: 'from-indigo-600 to-blue-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'ZAI_API_KEY',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    api: 'openai-completions',
    popularModels: [
      { id: 'zai/glm-4.7', suggestedAlias: 'glm' },
    ],
    docsUrl: 'https://bigmodel.cn/dev/api',
  },

  // ── 11. Moonshot (Kimi) ───────────────────────────────────
  {
    id: 'moonshot',
    nameKey: 'config.provider.moonshot',
    name: 'Moonshot (Kimi)',
    icon: '🌙',
    colorClass: 'from-blue-500 to-indigo-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.ai/v1',
    api: 'openai-completions',
    popularModels: [
      { id: 'moonshot/kimi-k2.5', suggestedAlias: 'kimi' },
    ],
    docsUrl: 'https://platform.moonshot.ai/docs',
  },

  // ── 12. Cerebras ──────────────────────────────────────────
  {
    id: 'cerebras',
    nameKey: 'config.provider.cerebras',
    name: 'Cerebras',
    icon: 'C',
    colorClass: 'from-red-500 to-orange-600',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai/v1',
    api: 'openai-completions',
    popularModels: [],
    docsUrl: 'https://inference-docs.cerebras.ai/',
  },

  // ── 13. GitHub Copilot ────────────────────────────────────
  {
    id: 'github-copilot',
    nameKey: 'config.provider.github-copilot',
    name: 'GitHub Copilot',
    icon: '⊙',
    colorClass: 'from-gray-600 to-gray-700',
    authModes: ['oauth'],
    defaultAuthMode: 'oauth',
    envKey: 'GH_TOKEN',
    api: 'openai-completions',
    popularModels: [
      { id: 'github-copilot/gpt-5.2', suggestedAlias: 'copilot' },
    ],
    docsUrl: 'https://docs.github.com/en/copilot',
  },

  // ── 14. Hugging Face ──────────────────────────────────────
  {
    id: 'huggingface',
    nameKey: 'config.provider.huggingface',
    name: 'Hugging Face',
    icon: '🤗',
    colorClass: 'from-yellow-500 to-amber-600',
    authModes: ['token'],
    defaultAuthMode: 'token',
    envKey: 'HF_TOKEN',
    baseUrl: 'https://api-inference.huggingface.co',
    api: 'openai-completions',
    popularModels: [],
    docsUrl: 'https://huggingface.co/docs/api-inference',
  },

  // ── 15. KiloCode ──────────────────────────────────────────
  {
    id: 'kilocode',
    nameKey: 'config.provider.kilocode',
    name: 'KiloCode',
    icon: 'K',
    colorClass: 'from-purple-600 to-fuchsia-700',
    authModes: ['api_key'],
    defaultAuthMode: 'api_key',
    envKey: 'KILOCODE_API_KEY',
    baseUrl: 'https://api.kilo.ai/api/gateway/',
    api: 'openai-completions',
    popularModels: [],
    docsUrl: 'https://kilo.ai/docs',
  },

  // ── 16. Ollama (local) ────────────────────────────────────
  {
    id: 'ollama',
    nameKey: 'config.provider.ollama',
    name: 'Ollama',
    icon: '🦙',
    colorClass: 'from-stone-600 to-neutral-700',
    authModes: ['token'],
    defaultAuthMode: 'token',
    envKey: '',
    baseUrl: 'http://localhost:11434',
    api: 'openai-completions',
    popularModels: [
      { id: 'ollama/llama3.2', suggestedAlias: 'llama' },
      { id: 'ollama/mistral',  suggestedAlias: 'mistral-local' },
    ],
    docsUrl: 'https://ollama.ai/docs',
  },

  // ── 17. Custom (OpenAI-compatible) ────────────────────────
  {
    id: 'custom',
    nameKey: 'config.provider.custom',
    name: 'Custom',
    icon: '⚙',
    colorClass: 'from-slate-500 to-gray-600',
    authModes: ['api_key', 'token'],
    defaultAuthMode: 'api_key',
    envKey: '',
    baseUrl: '',
    api: 'openai-completions',
    popularModels: [],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getTemplateById(id: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((t) => t.id === id);
}

/** Returns the Tailwind gradient `from/to` classes for a given provider id */
export function getProviderColor(id: string): string {
  const tpl = getTemplateById(id);
  return tpl ? tpl.colorClass : 'from-slate-500 to-gray-600';
}

/** Popular providers shown in the "quick pick" grid */
export const POPULAR_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'xai',
  'groq',
];
