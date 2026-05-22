/** File tree entry returned by the server. */
export interface TreeEntry {
  name: string;
  /** Relative path from workspace root. */
  path: string;
  type: 'file' | 'directory';
  /** Bytes, files only. */
  size?: number;
  /** Epoch ms. */
  mtime?: number;
  /** True for binary files (non-editable). */
  binary?: boolean;
  /** Directory children — null = not loaded yet, [] = empty. */
  children?: TreeEntry[] | null;
  /** Set when the recursive listing of this directory was truncated by the response budget. */
  childrenTruncated?: boolean;
  /** Cursor to resume the child listing at via `?path=<this.path>&cursor=<childrenNextCursor>`. */
  childrenNextCursor?: string;
}

/** An open file tab in the editor. */
export interface OpenFile {
  path: string;
  name: string;
  content: string;
  /** Last saved content, for dirty detection. */
  savedContent: string;
  dirty: boolean;
  locked: boolean;
  /** Mtime from last load/save (for conflict detection). */
  mtime: number;
  /** Loading state (initial fetch). */
  loading: boolean;
  /** Error message if fetch failed. */
  error?: string;
  /** Version counter for raw asset viewers (images, PDFs) to trigger remount. */
  viewerVersion?: number;
}
