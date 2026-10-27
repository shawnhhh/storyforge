export interface TrashEntry {
  id: string
  novelId: string
  kind: string
  name: string
  deletedAt: string
  expiresAt: string
  affected: Record<string, number>
}
export interface TrashPreview { name: string; documents: { title: string; text: string }[] }
