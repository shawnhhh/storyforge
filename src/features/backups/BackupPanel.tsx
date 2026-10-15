import { useEffect, useRef, useState } from 'react'
import type { BackupHistory, RestorePreparation } from '../../../shared/contracts/backups'
import { api } from '../novels/api'

const kinds = { manual: '手动备份', automatic: '自动备份', 'before-restore': '恢复前安全备份' }
const time = (value: string) => new Date(value).toLocaleString('zh-CN')

export function BackupPanel({ onBack }: { onBack: () => void }) {
  const [history, setHistory] = useState<BackupHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('正在读取备份历史…')
  const [retention, setRetention] = useState(14)
  const [enabled, setEnabled] = useState(true)
  const [prepared, setPrepared] = useState<RestorePreparation | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [restored, setRestored] = useState(false)
  const active = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let mounted = true
    api.backups().then(result => {
      if (!mounted) return
      setHistory(result); setRetention(result.settings.retention); setEnabled(result.settings.enabled); setStatus('')
    }).catch(reason => { if (mounted) { setError(reason instanceof Error ? reason.message : '读取失败'); setStatus('') } })
    return () => { mounted = false }
  }, [])
  useEffect(() => {
    if (!prepared) return
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); opener.current?.focus() }
  }, [prepared])
  async function run(message: string, action: () => Promise<string>) {
    if (active.current) return
    active.current = true; setBusy(true); setError(''); setStatus(message)
    try { const result = await action(); setStatus(result); setHistory(await api.backups()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); setStatus('') }
    finally { setBusy(false); active.current = false }
  }
  const blocked = busy || !history || restored
  return <section className="backup-panel" aria-busy={busy}>
    <div className="button-row"><button disabled={busy} onClick={() => restored ? window.location.reload() : onBack()}>{restored ? '重新加载工作台' : '返回写作'}</button><button disabled={blocked} className="primary" onClick={() => { void run('正在创建安全备份…', async () => { await api.createBackup(); return '备份创建成功' }) }}>手动备份</button><button disabled={busy || restored} onClick={() => { void run('正在读取…', async () => '备份历史已刷新') }}>刷新备份历史</button></div>
    <p className="backup-last">上次备份：{history?.entries[0] ? time(history.entries[0].createdAt) : '尚无备份'}</p>
    <p className="backup-note">服务启动时及运行期间每分钟检查一次；距上次自动备份满 24 小时后创建备份。服务关闭时不运行，Mac 休眠期间不触发，唤醒后补做一次。</p>
    {history && <p className="backup-note backup-path">备份目录：{history.directory}</p>}
    <form className="backup-settings" onSubmit={event => { event.preventDefault(); if (history && retention < history.settings.retention && !window.confirm('减少保留数量后，下次成功自动备份会清理较早的自动备份。手动和恢复前备份会保留。确认继续？')) return; void run('正在保存设置…', async () => { await api.backupSettings({ enabled, retention }); return '备份设置已保存，下次检查生效' }) }}>
      <label><input type="checkbox" disabled={blocked} checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用每日自动备份</label>
      <label>自动备份保留数量 <input type="number" aria-label="自动备份保留数量" min={1} max={365} required disabled={blocked} value={retention} onChange={event => setRetention(Number(event.target.value))} /></label>
      <button disabled={blocked || !Number.isInteger(retention) || retention < 1 || retention > 365}>保存备份设置</button>
      <p className="backup-note">仅在成功自动备份后清理超出数量的自动备份。手动备份和恢复前安全备份始终保留。</p>
    </form>
    {status && <p className="backup-status" role="status">{status}</p>}
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {history?.lastAutomaticError && <p className="workspace-error" role="alert">最近自动备份失败：{history.lastAutomaticError}。服务运行时将在下一次检查重试。</p>}
    {history?.busy && <p role="status">服务正在备份或恢复，请稍后刷新。</p>}
    <h2>备份历史</h2>
    {history && !history.entries.length && <p className="backup-note">尚无备份。点击“手动备份”保存当前全部小说。</p>}
    <ul className="backup-list">{history?.entries.map(entry => <li key={entry.id}>
      <div><strong>{time(entry.createdAt)}</strong><span>{kinds[entry.kind]} · {(entry.size / 1024).toFixed(1)} KB · 数据库 v{entry.schemaVersion}</span><small>{entry.id}</small><small>SHA-256：{entry.sha256}</small></div>
      <div className="button-row"><button disabled={blocked || history.busy} onClick={() => { void run('正在检查备份…', async () => { await api.verifyBackup(entry.id); return '完整性检查通过：SHA-256、SQLite、数据库版本及正文格式有效' }) }}>检查完整性</button><button className="danger" disabled={blocked || history.busy} onClick={() => {
        if (!window.confirm('恢复将替换当前全部小说、章节、人物和世界观。继续检查这份备份？检查后还需再次确认。')) return
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        void run('正在验证恢复备份…', async () => { const result = await api.prepareRestore(entry.id); setConfirmation(''); setPrepared(result); return '备份验证通过，请再次确认恢复' })
      }}>恢复此备份</button></div>
    </li>)}</ul>
    {prepared && <dialog ref={dialog} className="novel-dialog" aria-labelledby="restore-title" onCancel={event => { event.preventDefault(); if (!busy) setPrepared(null) }}>
      <form onSubmit={event => { event.preventDefault(); if (confirmation !== '替换当前全部数据' || busy) return; void run('正在创建恢复前安全备份并恢复…', async () => {
        const result = await api.restore(prepared.backup.id, prepared.token)
        setPrepared(null); setRestored(true)
        return `恢复成功。恢复前数据已保存为 ${result.safety.id}。请重新加载工作台；其他窗口也须刷新整个页面。`
      }) }}>
        <h2 id="restore-title">确认替换全部数据</h2>
        <p>当前全部小说、章节、人物和世界观将被 {time(prepared.backup.createdAt)} 的备份替换。恢复前会自动创建安全备份。请先保存其他窗口的修改，并导出未保存草稿。</p>
        {prepared.backup.schemaVersion === 1 && <p className="backup-note">此备份创建于人物与世界观功能之前；恢复后人物与世界观资料库将为空。当前资料会保存在恢复前安全备份中。</p>}
        <p className="backup-note">确认有效期至 {time(prepared.expiresAt)}。</p>
        <label>请输入「替换当前全部数据」<input autoFocus disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert" className="dialog-error">{error}</p>}
        <div className="button-row"><button type="button" disabled={busy} onClick={() => setPrepared(null)}>取消</button><button className="danger" disabled={busy || confirmation !== '替换当前全部数据'}>{busy ? '恢复中…' : '确认恢复'}</button></div>
      </form>
    </dialog>}
  </section>
}
