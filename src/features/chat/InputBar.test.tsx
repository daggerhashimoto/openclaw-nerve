import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputBar, type InputBarHandle, resetInputBarComposerSnapshotForTests } from './InputBar';
import { compressImage } from './image-compress';

vi.mock('./image-compress', () => ({
  compressImage: vi.fn(async (file: File) => ({
    base64: `mock-${file.name}`,
    mimeType: file.type || 'application/octet-stream',
    preview: `data:${file.type};base64,mock-${file.name}`,
    width: 1024,
    height: 768,
    bytes: `mock-${file.name}`.length,
    iterations: 1,
    attempts: [],
    targetBytes: 29_491,
    maxBytes: 32_768,
    minDimension: 512,
  })),
}));

vi.mock('@/features/voice/useVoiceInput', () => ({
  useVoiceInput: () => ({
    voiceState: 'idle',
    interimTranscript: '',
    wakeWordEnabled: false,
    toggleWakeWord: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTabCompletion', () => ({
  useTabCompletion: () => ({
    handleKeyDown: vi.fn(() => false),
    reset: vi.fn(),
  }),
}));

const { mockUseInputHistory } = vi.hoisted(() => ({
  mockUseInputHistory: vi.fn(() => ({
    addToHistory: vi.fn(),
    isNavigating: vi.fn(() => false),
    reset: vi.fn(),
    navigateUp: vi.fn(() => null),
    navigateDown: vi.fn(() => null),
  })),
}));

vi.mock('@/hooks/useInputHistory', () => ({
  useInputHistory: mockUseInputHistory,
}));

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => ({
    sessions: [],
    agentName: 'Agent',
  }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    liveTranscriptionPreview: false,
    sttInputMode: 'browser',
    sttProvider: 'browser',
  }),
}));

describe('InputBar', () => {
  const originalFetch = global.fetch;
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalCancelAnimationFrame = global.cancelAnimationFrame;
  const originalCreateObjectUrl = global.URL.createObjectURL;
  const originalRevokeObjectUrl = global.URL.revokeObjectURL;

  let uploadConfigResponse: {
    twoModeEnabled: boolean;
    inlineEnabled: boolean;
    fileReferenceEnabled: boolean;
    modeChooserEnabled: boolean;
    inlineAttachmentMaxMb: number;
    inlineImageContextMaxBytes: number;
    inlineImageAutoDowngradeToFileReference: boolean;
    inlineImageShrinkMinDimension: number;
    inlineImageMaxDimension: number;
    inlineImageWebpQuality: number;
    exposeInlineBase64ToAgent: boolean;
  };

  beforeEach(() => {
    resetInputBarComposerSnapshotForTests();

    uploadConfigResponse = {
      twoModeEnabled: true,
      inlineEnabled: true,
      fileReferenceEnabled: true,
      modeChooserEnabled: true,
      inlineAttachmentMaxMb: 1,
      inlineImageContextMaxBytes: 32_768,
      inlineImageAutoDowngradeToFileReference: true,
      inlineImageShrinkMinDimension: 512,
      inlineImageMaxDimension: 2048,
      inlineImageWebpQuality: 82,
      exposeInlineBase64ToAgent: false,
    };

    vi.mocked(compressImage).mockImplementation(async (file: File) => ({
      base64: `mock-${file.name}`,
      mimeType: file.type || 'application/octet-stream',
      preview: `data:${file.type};base64,mock-${file.name}`,
      width: 1024,
      height: 768,
      bytes: `mock-${file.name}`.length,
      iterations: 1,
      attempts: [],
      targetBytes: 29_491,
      maxBytes: 32_768,
      minDimension: 512,
    }));

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/upload-config')) {
        return {
          ok: true,
          json: async () => uploadConfigResponse,
        } as Response;
      }
      if (url.includes('/api/upload-reference/resolve')) {
        const headers = init?.headers;
        const contentType = headers instanceof Headers
          ? (headers.get('Content-Type') || headers.get('content-type') || '')
          : Array.isArray(headers)
            ? (headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '')
            : (headers as Record<string, string> | undefined)?.['Content-Type']
              ?? (headers as Record<string, string> | undefined)?.['content-type']
              ?? '';

        if (contentType.includes('application/json')) {
          const payload = typeof init?.body === 'string'
            ? JSON.parse(init.body) as { path?: string }
            : {};
          const targetPath = payload.path || '';
          return {
            ok: true,
            json: async () => ({
              ok: true,
              items: [{
                kind: 'direct_workspace_reference',
                canonicalPath: targetPath,
                absolutePath: `/workspace/${targetPath}`,
                uri: `file:///workspace/${targetPath}`,
                mimeType: targetPath.endsWith('.png') ? 'image/png' : 'text/plain',
                sizeBytes: targetPath.endsWith('.png') ? 2048 : 1234,
                originalName: targetPath.split('/').pop() || targetPath,
              }],
            }),
          } as Response;
        }

        const formData = init?.body as FormData | undefined;
        const files = formData ? formData.getAll('files').filter((value): value is File => value instanceof File) : [];
        return {
          ok: true,
          json: async () => ({
            ok: true,
            items: files.map((file, index) => ({
              kind: 'imported_workspace_reference',
              canonicalPath: `.temp/nerve-uploads/2026/03/21/${index + 1}-${file.name}`,
              absolutePath: `/workspace/.temp/nerve-uploads/2026/03/21/${index + 1}-${file.name}`,
              uri: `file:///workspace/.temp/nerve-uploads/2026/03/21/${index + 1}-${file.name}`,
              mimeType: file.type || 'application/octet-stream',
              sizeBytes: file.size,
              originalName: file.name,
            })),
          }),
        } as Response;
      }
      if (url.includes('/api/files/tree')) {
        const parsed = new URL(url, 'http://localhost');
        const dirPath = parsed.searchParams.get('path') || '';
        const entries = dirPath === 'docs'
          ? [{ name: 'nested.txt', path: 'docs/nested.txt', type: 'file', size: 1234, binary: false }]
          : [
            { name: 'docs', path: 'docs', type: 'directory', children: null },
            { name: 'attach-me.png', path: 'attach-me.png', type: 'file', size: 2048, binary: false },
          ];
        return {
          ok: true,
          json: async () => ({
            ok: true,
            root: dirPath || '.',
            entries,
            workspaceInfo: {
              isCustomWorkspace: false,
              rootPath: '/workspace',
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ language: 'en' }),
      } as Response;
    }) as typeof fetch;

    global.URL.createObjectURL = vi.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    global.URL.createObjectURL = originalCreateObjectUrl;
    global.URL.revokeObjectURL = originalRevokeObjectUrl;
    vi.restoreAllMocks();
  });

  it('re-runs textarea resize after injected text when layout settles', async () => {
    const rafQueue: FrameRequestCallback[] = [];
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = vi.fn((id: number) => {
      if (id > 0 && id <= rafQueue.length) {
        rafQueue[id - 1] = () => {};
      }
    }) as typeof cancelAnimationFrame;

    const ref = createRef<InputBarHandle>();
    render(<InputBar ref={ref} onSend={vi.fn()} isGenerating={false} />);

    const textarea = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    let scrollHeightValue = 42;
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeightValue,
    });

    ref.current?.injectText('Plan context:\n- Title: Mobile composer polish', 'append');

    expect(textarea.style.height).toBe('42px');

    scrollHeightValue = 96;

    const firstFrame = rafQueue.shift();
    expect(firstFrame).toBeDefined();
    firstFrame?.(16);

    const secondFrame = rafQueue.shift();
    expect(secondFrame).toBeDefined();
    secondFrame?.(32);

    await waitFor(() => {
      expect(textarea.style.height).toBe('96px');
    });
  });

  it('shows the command palette shortcut in the composer helper copy', () => {
    render(<InputBar onSend={vi.fn()} isGenerating={false} />);

    expect(screen.getByText(/⌘K command palette/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ctrl\+F search/i)).not.toBeInTheDocument();
  });

  it('uses the paperclip as the single primary attachment affordance', async () => {
    render(<InputBar onSend={vi.fn()} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.click(await screen.findByLabelText('Attach files'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu', { name: 'Attachment actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Browse by path/i })).not.toBeInTheDocument();
  });

  it('stages workspace file add-to-chat requests as server_path file references for the active workspace agent', async () => {
    const onSend = vi.fn();
    const ref = createRef<InputBarHandle>();
    render(<InputBar ref={ref} onSend={onSend} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    await (ref.current as InputBarHandle & {
      addWorkspacePath: (path: string, kind: 'file' | 'directory', agentId?: string) => Promise<void>;
    } | null)?.addWorkspacePath('attach-me.png', 'file', 'agent-research');

    await waitFor(() => {
      expect(screen.getAllByText('attach-me.png')).toHaveLength(1);
      expect(screen.getByText('Local File')).toBeInTheDocument();
      expect(screen.queryByText('Path Ref')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    const [, attachments, uploadPayload] = onSend.mock.calls[0] as [
      string,
      Array<{ mimeType: string; content: string; name: string }>?,
      {
        descriptors: Array<{
          origin: string;
          mode: string;
          reference?: { kind: string; path: string; uri: string };
        }>;
      }?,
    ];

    expect(attachments).toBeUndefined();
    expect(uploadPayload?.descriptors[0]).toMatchObject({
      origin: 'server_path',
      mode: 'file_reference',
      name: 'attach-me.png',
      mimeType: 'image/png',
      reference: {
        kind: 'local_path',
        path: '/workspace/attach-me.png',
        uri: 'file:///workspace/attach-me.png',
      },
    });

    const resolveCall = vi.mocked(global.fetch).mock.calls.find(([input]) => String(input).includes('/api/upload-reference/resolve'));
    expect(resolveCall).toBeDefined();
    expect(JSON.parse(String((resolveCall?.[1] as RequestInit | undefined)?.body ?? '{}'))).toMatchObject({
      path: 'attach-me.png',
      agentId: 'agent-research',
    });

    const fetchUrls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(fetchUrls.some((url) => url.includes('/api/upload-reference/resolve'))).toBe(true);
    expect(fetchUrls.some((url) => url.includes('/api/files/resolve'))).toBe(false);
  });

  it('adds workspace directories to chat as path context', async () => {
    const ref = createRef<InputBarHandle>();
    render(<InputBar ref={ref} onSend={vi.fn()} isGenerating={false} />);

    await ref.current?.addWorkspacePath('src/features/chat', 'directory');

    expect(screen.getByDisplayValue(/Workspace context:/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Path: src\/features\/chat/i)).toBeInTheDocument();
  });

  it('stages browser uploads as uploads without exposing a file-reference chooser', async () => {
    render(<InputBar onSend={vi.fn()} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const smallImage = new File([new Uint8Array(100_000)], 'small.png', { type: 'image/png' });
    const pdf = new File([new Uint8Array(400_000)], 'notes.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, {
      target: { files: [smallImage, pdf] },
    });

    await waitFor(() => {
      expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);
      expect(screen.getByText('small.png')).toBeInTheDocument();
      expect(screen.getByText('notes.pdf')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Upload mode for small.png')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Upload mode for notes.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('File Reference')).not.toBeInTheDocument();
  });

  it('rejects oversized non-image browser uploads with browse-by-path guidance', async () => {
    render(<InputBar onSend={vi.fn()} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const archive = new File([new Uint8Array(2 * 1024 * 1024)], 'too-big.zip', { type: 'application/zip' });

    fireEvent.change(fileInput, {
      target: { files: [archive] },
    });

    await waitFor(() => {
      expect(screen.getByText(/too large to send as a browser upload/i)).toBeInTheDocument();
      expect(screen.getByText(/choose a smaller file or browse by path/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('too-big.zip')).not.toBeInTheDocument();
  });

  it('stages browser uploads into file-reference descriptors before send', async () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} isGenerating={false} />);

    const textarea = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'hello' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const smallImage = new File([new Uint8Array(80_000)], 'shot.png', { type: 'image/png' });
    fireEvent.change(fileInput, {
      target: { files: [smallImage] },
    });

    await waitFor(() => {
      expect(screen.getByText('shot.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    expect(compressImage).not.toHaveBeenCalled();

    const [text, attachments, uploadPayload] = onSend.mock.calls[0] as [
      string,
      Array<{ mimeType: string; content: string; name: string }>?,
      {
        descriptors: Array<{
          origin: string;
          mode: string;
          reference?: { kind: string; path: string; uri: string };
          preparation?: {
            outcome: string;
          };
        }>;
      }?,
    ];
    expect(text).toBe('hello');
    expect(attachments).toBeUndefined();
    expect(uploadPayload?.descriptors).toHaveLength(1);
    expect(uploadPayload?.descriptors[0]).toMatchObject({
      origin: 'upload',
      mode: 'file_reference',
      reference: {
        kind: 'local_path',
        path: '/workspace/.temp/nerve-uploads/2026/03/21/1-shot.png',
        uri: 'file:///workspace/.temp/nerve-uploads/2026/03/21/1-shot.png',
      },
      preparation: {
        outcome: 'file_reference_ready',
      },
    });

    const fetchUrls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(fetchUrls.some((url) => url.includes('/api/upload-reference/resolve'))).toBe(true);
    expect(fetchUrls.some((url) => url.includes('/api/upload-stage'))).toBe(false);
  });

  it('keeps large browser-uploaded images on the staged file-reference path', async () => {
    const onSend = vi.fn();

    render(<InputBar onSend={onSend} isGenerating={false} />);

    const textarea = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'handle safely' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const image = new File([new Uint8Array(2 * 1024 * 1024)], 'oversized-inline.png', { type: 'image/png' });

    fireEvent.change(fileInput, {
      target: { files: [image] },
    });

    await waitFor(() => {
      expect(screen.getByText('oversized-inline.png')).toBeInTheDocument();
      expect(screen.getByText('Upload')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend.mock.calls[0][1]).toBeUndefined();
    expect(onSend.mock.calls[0][2].descriptors[0]).toMatchObject({
      origin: 'upload',
      mode: 'file_reference',
      reference: {
        path: '/workspace/.temp/nerve-uploads/2026/03/21/1-oversized-inline.png',
      },
    });
  });

  it('does not re-inline staged browser uploads during send preparation', async () => {
    const onSend = vi.fn();
    vi.mocked(compressImage).mockImplementation(async (file: File) => ({
      base64: 'x'.repeat(200_000),
      mimeType: file.type || 'application/octet-stream',
      preview: `data:${file.type};base64,oversized-${file.name}`,
      width: 512,
      height: 512,
      bytes: 150_000,
      iterations: 8,
      attempts: [],
      targetBytes: 29_491,
      maxBytes: 32_768,
      minDimension: 512,
    }));

    render(<InputBar onSend={onSend} isGenerating={false} />);

    const textarea = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'ship staged upload' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const image = new File([new Uint8Array(80_000)], 'oversized-inline.png', { type: 'image/png' });

    fireEvent.change(fileInput, {
      target: { files: [image] },
    });

    await waitFor(() => {
      expect(screen.getByText('oversized-inline.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(compressImage).not.toHaveBeenCalled();
    expect(onSend.mock.calls[0][2].descriptors[0].mode).toBe('file_reference');
  });

  it('keeps browser uploads on the staged file-reference transport path', async () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} isGenerating={false} />);

    const textarea = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'ship this file' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const doc = new File([new Uint8Array(40_000)], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, {
      target: { files: [doc] },
    });

    await waitFor(() => {
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    const [text, attachments, uploadPayload] = onSend.mock.calls[0] as [
      string,
      Array<{ mimeType: string; content: string; name: string }>?,
      {
        descriptors: Array<{
          origin: string;
          mode: string;
          inline?: { base64: string };
          reference?: { kind: string; path: string; uri: string };
        }>;
      }?,
    ];

    expect(text).toBe('ship this file');
    expect(attachments).toBeUndefined();
    expect(uploadPayload?.descriptors).toHaveLength(1);
    expect(uploadPayload?.descriptors[0]).toMatchObject({
      origin: 'upload',
      mode: 'file_reference',
      reference: {
        kind: 'local_path',
        path: '/workspace/.temp/nerve-uploads/2026/03/21/1-notes.txt',
        uri: 'file:///workspace/.temp/nerve-uploads/2026/03/21/1-notes.txt',
      },
    });
  });

  it('hides manual forwarding controls and forwards workspace path attachments by default', async () => {
    const onSend = vi.fn();
    const ref = createRef<InputBarHandle>();
    render(<InputBar ref={ref} onSend={onSend} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    await ref.current?.addWorkspacePath('attach-me.png', 'file');

    await waitFor(() => {
      expect(screen.getAllByText('attach-me.png').length).toBeGreaterThan(0);
    });

    expect(screen.queryByLabelText(/Allow forwarding .* to subagents/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][2].descriptors[0].policy.forwardToSubagents).toBe(true);
    expect(onSend.mock.calls[0][2].manifest.allowSubagentForwarding).toBe(true);
  });

  it('forwards inline uploads by default without a forwarding toggle', async () => {
    const onSend = vi.fn();
    render(<InputBar onSend={onSend} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const smallImage = new File([new Uint8Array(120_000)], 'inline-forwardable.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [smallImage] } });

    await waitFor(() => {
      expect(screen.getByText('inline-forwardable.png')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/Allow forwarding .* to subagents/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][2].descriptors[0].origin).toBe('upload');
    expect(onSend.mock.calls[0][2].descriptors[0].mode).toBe('file_reference');
    expect(onSend.mock.calls[0][2].descriptors[0].policy.forwardToSubagents).toBe(true);
    expect(onSend.mock.calls[0][2].manifest.allowSubagentForwarding).toBe(true);
  });

  it('disables the attachment menu when both upload modes are disabled', async () => {
    uploadConfigResponse.inlineEnabled = false;
    uploadConfigResponse.fileReferenceEnabled = false;

    render(<InputBar onSend={vi.fn()} isGenerating={false} />);

    const attachButton = await screen.findByLabelText('Uploads disabled by configuration');
    expect(attachButton).toBeDisabled();
  });

  it('rejects browser uploads when inline uploads are disabled and directs the user to browse by path', async () => {
    uploadConfigResponse.inlineEnabled = false;
    uploadConfigResponse.fileReferenceEnabled = true;
    uploadConfigResponse.modeChooserEnabled = false;

    render(<InputBar onSend={vi.fn()} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const image = new File([new Uint8Array(100_000)], 'vision-off.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [image] } });

    await waitFor(() => {
      expect(screen.getByText(/browser uploads are disabled by configuration/i)).toBeInTheDocument();
      expect(screen.getByText(/enable uploads or browse by path/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('vision-off.png')).not.toBeInTheDocument();
  });

  it('allows large images onto the upload path when only inline mode is enabled', async () => {
    uploadConfigResponse.inlineEnabled = true;
    uploadConfigResponse.fileReferenceEnabled = false;
    uploadConfigResponse.modeChooserEnabled = false;
    uploadConfigResponse.inlineAttachmentMaxMb = 1;

    render(<InputBar onSend={vi.fn()} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const largeImage = new File([new Uint8Array(2 * 1024 * 1024)], 'too-large-inline.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [largeImage] } });

    await waitFor(() => {
      expect(screen.getByText('too-large-inline.png')).toBeInTheDocument();
      expect(screen.getByText('Upload')).toBeInTheDocument();
    });
    expect(screen.queryByText(/too large to send as a browser upload/i)).not.toBeInTheDocument();
  });

  it('restores in-progress text and staged uploads after remount', async () => {
    const onSend = vi.fn();
    const firstRender = render(<InputBar onSend={onSend} isGenerating={false} />);

    const textarea = firstRender.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'keep this draft alive' } });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await waitFor(() => {
      expect(fileInput.accept).toBe('*/*');
    });

    const image = new File([new Uint8Array(50_000)], 'persist-me.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [image] } });

    await waitFor(() => {
      expect(firstRender.getByText('persist-me.png')).toBeInTheDocument();
      expect(firstRender.getByDisplayValue('keep this draft alive')).toBeInTheDocument();
    });

    firstRender.unmount();

    render(<InputBar onSend={onSend} isGenerating={false} />);

    expect(screen.getByDisplayValue('keep this draft alive')).toBeInTheDocument();
    expect(screen.getByText('persist-me.png')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

});

describe('InputBar ArrowUp behavior', () => {
  it('moves caret to start on single-line input before recalling history', async () => {
    const navigateUp = vi.fn(() => 'previous command');
    mockUseInputHistory.mockReturnValue({
      addToHistory: vi.fn(),
      isNavigating: vi.fn(() => false),
      reset: vi.fn(),
      navigateUp,
      navigateDown: vi.fn(() => null),
    } as ReturnType<typeof useInputHistory>);

    render(<InputBar onSend={vi.fn()} isGenerating={false} />);
    const input = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'current draft' } });
    input.setSelectionRange(input.value.length, input.value.length);

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(navigateUp).not.toHaveBeenCalled();
    expect(input.value).toBe('current draft');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(0);
  });

  it('recalls history when caret is already at start on single-line input', async () => {
    const navigateUp = vi.fn(() => 'previous command');
    mockUseInputHistory.mockReturnValue({
      addToHistory: vi.fn(),
      isNavigating: vi.fn(() => false),
      reset: vi.fn(),
      navigateUp,
      navigateDown: vi.fn(() => null),
    } as ReturnType<typeof useInputHistory>);

    render(<InputBar onSend={vi.fn()} isGenerating={false} />);
    const input = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'current draft' } });
    input.setSelectionRange(0, 0);

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(navigateUp).toHaveBeenCalledWith('current draft');
    expect(input.value).toBe('previous command');
  });

  it('keeps native behavior for multi-line input', async () => {
    const navigateUp = vi.fn(() => 'previous command');
    mockUseInputHistory.mockReturnValue({
      addToHistory: vi.fn(),
      isNavigating: vi.fn(() => false),
      reset: vi.fn(),
      navigateUp,
      navigateDown: vi.fn(() => null),
    } as ReturnType<typeof useInputHistory>);

    render(<InputBar onSend={vi.fn()} isGenerating={false} />);
    const input = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'line 1\nline 2' } });
    input.setSelectionRange(input.value.length, input.value.length);
    const beforeCaret = input.selectionStart;

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(navigateUp).not.toHaveBeenCalled();
    expect(input.value).toBe('line 1\nline 2');
    expect(input.selectionStart).toBe(beforeCaret);
  });
});
