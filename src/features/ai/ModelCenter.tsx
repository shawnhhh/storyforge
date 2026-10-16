import type { AiCatalog, GenerationParameters } from '../../../shared/contracts/ai'

export function ModelCenter({ catalog, modelId, parameters, disabled, onModel, onParameters }: { catalog: AiCatalog | null; modelId: string; parameters: GenerationParameters; disabled: boolean; onModel: (id: string) => void; onParameters: (value: GenerationParameters) => void }) {
  const model = catalog?.models.find(item => item.id === modelId)
  return <details className="ai-settings"><summary>模型配置中心 · {model?.label ?? '正在加载'}</summary>
    <p className="ai-note">模型目录、接口与密钥由本机服务端配置。这里仅选择模型和本次生成参数，不保存密钥或写作内容。</p>
    <fieldset disabled={disabled} className="ai-options">
      <label>模型选择<select aria-label="模型选择" value={modelId} onChange={event => onModel(event.target.value)}>{catalog?.models.map(item => <option key={item.id} value={item.id}>{item.label} · {item.model}{item.configured ? '' : '（未配置密钥）'}</option>)}</select></label>
      {model && !model.configured && <p role="alert">所选模型未配置密钥。请在本地服务端环境配置该提供商后重启。</p>}
      <div className="ai-parameter-grid">{([
        ['temperature', '创意程度', 0, 2, 0.1], ['topP', '采样范围', 0.1, 1, 0.05], ['maxOutputTokens', '最大输出 tokens', 64, model?.maxOutputTokens ?? 4096, 1],
      ] as const).map(([field, label, min, max, step]) => <label key={field}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={parameters[field]} onChange={event => onParameters({ ...parameters, [field]: Number(event.target.value) })} /></label>)}</div>
    </fieldset>
    {catalog && <div className="ai-note"><p>每分钟最多 {catalog.policy.requestsPerMinute} 次；会话剩余 {catalog.remaining.requests} 次 / {catalog.remaining.tokens} tokens 预算。单次输入上限 {catalog.policy.maxInputTokens}（按 UTF-8 保守估算）。</p><p>{model?.inputUsdPerMillion != null && model.outputUsdPerMillion != null ? `服务端配置报价：输入 $${model.inputUsdPerMillion} / 输出 $${model.outputUsdPerMillion} 每百万 tokens；单次费用上限 $${catalog.policy.maxRequestUsd}，会话剩余 $${catalog.remaining.usd.toFixed(4)}。` : '未配置报价，无法预估美元费用；仍执行 token、输出和请求次数限额。'}</p><p>取消、失败与重新生成也计入保守预留预算；会话预算随服务重启重置，账单以提供商为准。</p></div>}
  </details>
}
