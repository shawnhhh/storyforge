import StarterKit from '@tiptap/starter-kit'

// Each editor receives its own configuration; no editor instance is created here.
export function createEditorExtensions() {
  return [StarterKit.configure({})]
}
