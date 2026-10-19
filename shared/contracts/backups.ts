export interface BackupEntry {
  id: string
  createdAt: string
  size: number
  sha256: string
  schemaVersion: number
  planningVersion?: 1 | 2
  kind: 'manual' | 'automatic' | 'before-restore'
}
export interface BackupSettings { enabled: boolean; retention: number }
export interface BackupHistory {
  entries: BackupEntry[]
  settings: BackupSettings
  directory: string
  lastAutomaticError: string | null
  busy: boolean
}
export interface RestorePreparation { token: string; backup: BackupEntry; expiresAt: string }
