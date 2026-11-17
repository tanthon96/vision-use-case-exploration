export interface ModelInfo {
  provider: string
  model_id: string
  display_name: string
  supports_vision: boolean
  context_window: number
  supports_thinking: boolean
}

export interface FewShotExample {
  prompt: string
  expected: string
  image?: string  // base64 or file path
}

/** A bundled reference doc composed into the skill's prompt at run time. */
export interface SkillReference {
  name: string
  content: string
}

/** Optional post-processing script run on the model output after generation. */
export interface SkillPostprocess {
  script_name?: string
  script_source?: string
}

export interface Skill {
  name: string
  description: string
  system_prompt: string
  task_template: string
  metrics: string[]
  few_shot_examples: FewShotExample[]
  _source?: 'bundled' | 'user'
  _path?: string
}

export interface ImageInput {
  /** Server-side image id, once uploaded. Optional during the brief window
   * between drop/capture and upload completion. */
  id?: string
  /** Base64 of the image bytes — populated for local-only state OR baked
   * annotation output before sending to the model. Server flow uses `id`. */
  data: string
  name: string
  preview?: string     // object URL or presigned URL for display
  rawData?: string     // original base64 before annotations baked in
  annotations?: Annotation[]
  source?: 'upload' | 'webcam' | 'screen'
  capturedAt?: number  // epoch ms
  sha256?: string
}

export interface Workspace {
  id: string
  name: string
  description: string
  owner_user_id: string
  created_at: string
  updated_at: string
}

export interface WorkspaceImage {
  id: string
  original_name: string
  mime_type: string
  sha256: string
  width: number | null
  height: number | null
  size_bytes: number
  source: string
  presigned_url: string
  deduped?: boolean
}

/** A generic downloadable workspace file (e.g. a model-generated CSV). */
export interface WorkspaceFile {
  id: string
  name: string
  mime_type: string
  size_bytes: number
  source: string
  presigned_url: string
  created_at: string
}

export type ToolKind = 'select' | 'rectangle' | 'ellipse' | 'freehand' | 'arrow'

export interface BaseAnnotation {
  id: string
  color: string
  strokeWidth: number
}

export interface RectAnnotation extends BaseAnnotation {
  kind: 'rectangle'
  x: number
  y: number
  w: number
  h: number
}

export interface EllipseAnnotation extends BaseAnnotation {
  kind: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface FreehandAnnotation extends BaseAnnotation {
  kind: 'freehand'
  points: { x: number; y: number }[]
}

export interface ArrowAnnotation extends BaseAnnotation {
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
}

export type Annotation = RectAnnotation | EllipseAnnotation | FreehandAnnotation | ArrowAnnotation

export interface BenchmarkRequest {
  workspace_id: string
  chat_id?: string | null
  provider: string
  model_id: string
  skill_id?: string | null
  user_instruction: string
  images: { image_id: string; annotations: Annotation[] }[]
  thinking_effort?: string
  api_key?: string
  aws_access_key_id?: string
  aws_secret_access_key?: string
  aws_region?: string
  ollama_base_url?: string
}

export interface ChatSummary {
  id: string
  title: string
  message_count: number
  last_model: string | null
  last_skill: string | null
  archived: boolean
  created_at: string
  updated_at: string
}

export interface ChatModelStat {
  model_provider: string | null
  model_id: string | null
  input_tokens: number
  output_tokens: number
  estimated_cost: number | null
  message_count: number
}

export interface ChatStats {
  chat_id: string
  total_input_tokens: number
  total_output_tokens: number
  estimated_cost: number
  has_unpriced: boolean
  by_model: ChatModelStat[]
}

export interface PersistedMessageImage {
  image_id: string
  presigned_url: string
  position: number
  annotations: Annotation[]
  original_name: string
  sha256: string
}

export interface PersistedMessage {
  id: string
  chat_id: string
  sequence_no: number
  role: 'user' | 'assistant' | 'system'
  content_md: string
  thinking_md: string
  thinking_effort: string
  model_provider: string | null
  model_id: string | null
  skill_name: string | null
  latency_ms: number | null
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  error: string
  created_at: string
  images: PersistedMessageImage[]
}

export interface ComparisonImage {
  image_id: string
  presigned_url: string
  annotations: Annotation[]
  original_name: string
  sha256: string
}

export interface ComparisonItem {
  message_id: string
  chat_id: string
  chat_title: string
  workspace_id: string
  role: 'user' | 'assistant' | 'system'
  content_md: string
  model_provider: string | null
  model_id: string | null
  skill_name: string | null
  skill_system_prompt: string | null
  skill_task_template: string | null
  latency_ms: number | null
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  error: string
  created_at: string
  images: ComparisonImage[]
}

/** New shape from the workspace-scoped skills API. */
export interface PersistedSkill {
  id: string
  workspace_id: string
  name: string
  description: string
  system_prompt: string
  task_template: string
  metrics: string[]
  few_shot_examples: FewShotExample[]
  references: SkillReference[]
  postprocess: SkillPostprocess
  created_at: string
  updated_at: string
}

export type SSEEventType =
  | 'start' | 'token' | 'thinking' | 'replace_content' | 'metrics' | 'error' | 'done' | 'step' | 'postprocess' | 'files_saved'

export interface SSEEvent {
  type: SSEEventType
  content?: string
  image?: string
  images?: string[]
  batch_size?: number
  message?: string
  latency_ms?: number
  prompt_tokens?: number
  completion_tokens?: number
  files?: { id: string; name: string }[]
  kind?: string
  label?: string
  ok?: boolean
}

/** A visible execution step (skill invocation, model/tool call, etc.). */
export interface ChatStep {
  kind: 'skill' | 'model' | 'postprocess' | 'files'
  label: string
  status?: 'ok' | 'error'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Accumulated extended-thinking trace, shown in a collapsible dropdown. */
  thinking?: string
  images?: ImageInput[]
  skillName?: string
  modelProvider?: string
  modelId?: string
  /** Reasoning effort applied (low/medium/high/max/off); shown as a chip. */
  thinkingEffort?: string
  metrics?: {
    latency_ms: number
    prompt_tokens: number
    completion_tokens: number
  }
  error?: string
  streaming?: boolean
  steps?: ChatStep[]
}

export interface BenchmarkResult {
  run_id: number
  provider: string
  model: string
  skill: string
  image_name: string
  response: string
  latency_ms: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  error: string
  created_at: string
}

export interface ProviderCredentials {
  anthropic_api_key: string
  google_api_key: string
  aws_access_key_id: string
  aws_secret_access_key: string
  aws_region: string
  ollama_base_url: string
}
