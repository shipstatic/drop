import { WEB_FILE_ACCEPT } from '@shipstatic/types';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DropReturn, PickerMode } from '../src/useDrop';
import { useDrop } from '../src/useDrop';
import {
  dataTransferItem,
  dirEntry,
  dropEvent,
  entryTree,
  file,
  fileEntry,
  inputChangeEvent,
  READ_ENTRIES_BATCH_SIZE,
  shipStub,
  zipOf,
} from './fixtures/builders';

/**
 * **Aspect of `src/useDrop.ts`** — the DOM surface: drag/drop events, the hidden
 * input, and the prop getters. The sibling `useDrop.test.ts` covers the state
 * machine and actions.
 */
// `ship` is hoisted out of the render callback: an inline stub would be a new
// object every render, invalidating the useCallbacks that depend on it.
const setup = () => {
  const ship = shipStub();
  return renderHook(() => useDrop({ ship }));
};

describe('getDropzoneProps', () => {
  it('provides the three drag handlers and a click handler by default', () => {
    const props = setup().result.current.getDropzoneProps();

    expect(typeof props.onDragOver).toBe('function');
    expect(typeof props.onDragLeave).toBe('function');
    expect(typeof props.onDrop).toBe('function');
    expect(typeof props.onClick).toBe('function');
  });

  it('omits onClick when clickable is false', () => {
    expect(setup().result.current.getDropzoneProps({ clickable: false }).onClick).toBeUndefined();
  });

  it('includes onClick for an empty options object', () => {
    expect(setup().result.current.getDropzoneProps({}).onClick).toBeDefined();
  });

  it('opens the FOLDER picker on a dropzone click', () => {
    // `onClick` wraps `open()` rather than passing it by reference, because
    // React hands a click handler a MouseEvent — and `open` now takes a mode.
    // Passed by reference, that event would be the argument, and since it is
    // not the string 'folder', a naive `mode === 'folder'` check would have
    // opened the FILES picker on every dropzone click.
    const { result } = setup();
    const inputs = (['folder', 'files'] as const).map((mode) => {
      const input = document.createElement('input');
      (result.current.getInputProps(mode).ref as { current: HTMLInputElement | null }).current =
        input;
      return vi.spyOn(input, 'click');
    });

    act(() => result.current.getDropzoneProps().onClick?.());

    const [folder, files] = inputs;
    expect(folder).toHaveBeenCalledTimes(1);
    expect(files).not.toHaveBeenCalled();
  });

  it('is stable across renders', () => {
    const { result, rerender } = setup();
    const first = result.current.getDropzoneProps;
    rerender();
    expect(result.current.getDropzoneProps).toBe(first);
  });
});

describe('getInputProps', () => {
  it('describes a hidden, folder-capable file input', () => {
    const props = setup().result.current.getInputProps();

    expect(props.type).toBe('file');
    expect(props.style).toEqual({ display: 'none' });
    expect(props.multiple).toBe(true);
    // Folder is the default, so a bare call is what it always was
    expect(props.webkitdirectory).toBe('');
    expect(props.ref).toBeDefined();
  });

  it('describes the same input for an explicit folder mode', () => {
    const { result } = setup();
    expect(result.current.getInputProps('folder')).toEqual(result.current.getInputProps());
  });

  it('drops webkitdirectory in files mode — the one attribute that differs', () => {
    const props = setup().result.current.getInputProps('files');

    expect(props.type).toBe('file');
    expect(props.style).toEqual({ display: 'none' });
    expect(props.multiple).toBe(true);
    expect(props.webkitdirectory).toBeUndefined();
  });

  it('offers the shared accept hint in files mode, and never in folder mode', () => {
    const { result } = setup();

    // The list is the platform's, not this package's — a local list would be a
    // second source of truth for what a picker shows.
    expect(result.current.getInputProps('files').accept).toBe(WEB_FILE_ACCEPT);
    // A folder picker ignores `accept`; emitting it would advertise a filter
    // that does not apply.
    expect(result.current.getInputProps('folder').accept).toBeUndefined();
  });

  it('gives each mode its own ref, so both inputs can be mounted at once', () => {
    const { result } = setup();

    expect(result.current.getInputProps('folder').ref).not.toBe(
      result.current.getInputProps('files').ref,
    );
  });

  it('is stable across renders', () => {
    const { result, rerender } = setup();
    const first = result.current.getInputProps;
    rerender();
    expect(result.current.getInputProps).toBe(first);
  });
});

describe('dragging is orthogonal to the phase', () => {
  it('flips the flag on drag over and back on drag leave', () => {
    const { result } = setup();

    act(() => result.current.getDropzoneProps().onDragOver(dropEvent()));
    expect(result.current.isDragging).toBe(true);
    expect(result.current.phase).toBe('idle');

    act(() => result.current.getDropzoneProps().onDragLeave(dropEvent()));
    expect(result.current.isDragging).toBe(false);
    expect(result.current.phase).toBe('idle');
  });

  it('leaves a ready phase intact through a drag', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([file('index.html', '<html>', 'text/html')]);
    });
    expect(result.current.phase).toBe('ready');

    act(() => result.current.getDropzoneProps().onDragOver(dropEvent()));
    expect(result.current.phase).toBe('ready');
    expect(result.current.isDragging).toBe(true);

    // Leaving a drag cannot change the phase. Were dragging a phase, this would
    // need re-deriving which phase to return to by re-scanning file statuses.
    act(() => result.current.getDropzoneProps().onDragLeave(dropEvent()));
    expect(result.current.phase).toBe('ready');
    expect(result.current.files).toHaveLength(1);
  });

  it('leaves an error phase intact through a drag', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([file('app.js', 'x')]);
    });
    expect(result.current.phase).toBe('error');

    act(() => result.current.getDropzoneProps().onDragOver(dropEvent()));
    act(() => result.current.getDropzoneProps().onDragLeave(dropEvent()));

    expect(result.current.phase).toBe('error');
  });

  it('can drag while processing without disturbing the phase', () => {
    const { result } = setup();

    act(() => {
      void result.current.processFiles([file('index.html', '<html>', 'text/html')]);
    });
    act(() => result.current.getDropzoneProps().onDragOver(dropEvent()));

    expect(result.current.isDragging).toBe(true);
  });

  it('is idempotent — repeated dragover does not churn state', () => {
    const { result } = setup();
    const props = result.current.getDropzoneProps();

    act(() => props.onDragOver(dropEvent()));
    const afterFirst = result.current.files;
    act(() => props.onDragOver(dropEvent()));

    expect(result.current.isDragging).toBe(true);
    expect(result.current.files).toBe(afterFirst);
  });

  it('ignores a drag leave that was never a drag', () => {
    const { result } = setup();
    act(() => result.current.getDropzoneProps().onDragLeave(dropEvent()));
    expect(result.current.isDragging).toBe(false);
  });

  it('calls preventDefault so the browser does not navigate', () => {
    const { result } = setup();
    const preventDefault = vi.fn();
    const event = { preventDefault, dataTransfer: { items: [], files: [] } } as never;

    act(() => result.current.getDropzoneProps().onDragOver(event));
    expect(preventDefault).toHaveBeenCalled();
  });
});

describe('onDrop', () => {
  it('traverses a dropped folder into paths', async () => {
    const { result } = setup();
    const [tree] = entryTree({ dist: { 'index.html': '<html>', 'app.js': 'x' } });

    await act(async () => {
      await result.current
        .getDropzoneProps()
        .onDrop(dropEvent({ items: [dataTransferItem({ entry: tree })] }));
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('dist');
    expect(result.current.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });

  it('reads a dropped folder larger than one readEntries batch', async () => {
    const { result } = setup();
    const children = [
      fileEntry('index.html', '<html>'),
      ...Array.from({ length: READ_ENTRIES_BATCH_SIZE + 5 }, (_, i) => fileEntry(`f${i}.txt`, 'x')),
    ];

    await act(async () => {
      await result.current
        .getDropzoneProps()
        .onDrop(dropEvent({ items: [dataTransferItem({ entry: dirEntry('dist', children) })] }));
    });

    expect(result.current.files).toHaveLength(children.length);
  });

  it('takes root-level files synchronously via getAsFile', async () => {
    const { result } = setup();
    const dropped = file('index.html', '<html>', 'text/html');

    await act(async () => {
      await result.current.getDropzoneProps().onDrop(
        dropEvent({
          items: [dataTransferItem({ entry: fileEntry('index.html'), asFile: dropped })],
        }),
      );
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.files[0].path).toBe('index.html');
  });

  it('falls back to getAsFile when webkitGetAsEntry returns null', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.getDropzoneProps().onDrop(
        dropEvent({
          items: [
            dataTransferItem({ entry: null, asFile: file('index.html', '<html>', 'text/html') }),
          ],
        }),
      );
    });

    expect(result.current.files.map((f) => f.path)).toEqual(['index.html']);
  });

  it('falls back to getAsFile when webkitGetAsEntry throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => {
      await result.current.getDropzoneProps().onDrop(
        dropEvent({
          items: [
            dataTransferItem({
              throws: true,
              asFile: file('index.html', '<html>', 'text/html'),
            }),
          ],
        }),
      );
    });

    expect(warn).toHaveBeenCalled();
    expect(result.current.files.map((f) => f.path)).toEqual(['index.html']);
  });

  it('drops an item whose entry throws and whose getAsFile yields nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => {
      await result.current
        .getDropzoneProps()
        .onDrop(dropEvent({ items: [dataTransferItem({ throws: true, asFile: null })] }));
    });

    expect(warn).toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
    expect(result.current.files).toEqual([]);
  });

  it('falls back to dataTransfer.files when the entry API is absent', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.getDropzoneProps().onDrop(
        dropEvent({
          items: [dataTransferItem({ noEntryApi: true })],
          files: [file('index.html', '<html>', 'text/html')],
        }),
      );
    });

    expect(result.current.files.map((f) => f.path)).toEqual(['index.html']);
  });

  it('ignores non-file items such as dragged text', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current
        .getDropzoneProps()
        .onDrop(dropEvent({ items: [dataTransferItem({ kind: 'string' })] }));
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.files).toEqual([]);
  });

  it('stays idle and stops dragging on an empty drop', async () => {
    const { result } = setup();
    const props = result.current.getDropzoneProps();

    act(() => props.onDragOver(dropEvent()));
    await act(async () => {
      await props.onDrop(dropEvent());
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.isDragging).toBe(false);
  });

  it('mixes a dropped folder and a loose file', async () => {
    const { result } = setup();
    const [tree] = entryTree({ assets: { 'app.css': 'body{}' } });

    await act(async () => {
      await result.current.getDropzoneProps().onDrop(
        dropEvent({
          items: [
            dataTransferItem({ entry: tree }),
            dataTransferItem({
              entry: fileEntry('index.html'),
              asFile: file('index.html', '<html>', 'text/html'),
            }),
          ],
        }),
      );
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.files.map((f) => f.path).sort()).toEqual([
      'assets/app.css',
      'index.html',
    ]);
  });

  it('clears the dragging flag once a drop begins', async () => {
    const { result } = setup();
    const props = result.current.getDropzoneProps();

    act(() => props.onDragOver(dropEvent()));
    await act(async () => {
      await props.onDrop(
        dropEvent({ items: [dataTransferItem({ entry: fileEntry('index.html', '<html>') })] }),
      );
    });

    expect(result.current.isDragging).toBe(false);
  });
});

describe('getInputProps onChange', () => {
  it('processes a folder selection', async () => {
    const { result } = setup();

    await act(async () => {
      result.current
        .getInputProps()
        .onChange(inputChangeEvent([file('index.html', '<html>', 'text/html')]));
    });

    expect(result.current.phase).toBe('ready');
  });

  it('clears the input value so the same folder can be re-selected', async () => {
    const { result } = setup();
    const event = inputChangeEvent([file('index.html', '<html>', 'text/html')]);

    await act(async () => {
      result.current.getInputProps().onChange(event);
    });

    expect(event.target.value).toBe('');
  });

  it('ignores a cancelled picker', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.getInputProps().onChange(inputChangeEvent([]));
    });

    expect(result.current.phase).toBe('idle');
  });

  it('tolerates a null files list', async () => {
    const { result } = setup();
    const event = { target: { files: null, value: 'x' } } as never;

    await act(async () => {
      result.current.getInputProps().onChange(event);
    });

    expect(result.current.phase).toBe('idle');
  });
});

describe('open', () => {
  /** Simulate React attaching the ref for a mode, and report the click spy. */
  const mount = (result: { current: DropReturn }, mode?: PickerMode) => {
    const input = document.createElement('input');
    (result.current.getInputProps(mode).ref as { current: HTMLInputElement | null }).current =
      input;
    return vi.spyOn(input, 'click');
  };

  it('clicks the input the ref is attached to', () => {
    const { result } = setup();
    const click = mount(result);

    act(() => result.current.open());

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('opens the folder picker by default and for an explicit folder mode', () => {
    const { result } = setup();
    const folder = mount(result, 'folder');
    const files = mount(result, 'files');

    act(() => result.current.open());
    act(() => result.current.open('folder'));

    expect(folder).toHaveBeenCalledTimes(2);
    expect(files).not.toHaveBeenCalled();
  });

  it('opens the files picker only when asked', () => {
    const { result } = setup();
    const folder = mount(result, 'folder');
    const files = mount(result, 'files');

    act(() => result.current.open('files'));

    expect(files).toHaveBeenCalledTimes(1);
    expect(folder).not.toHaveBeenCalled();
  });

  it('is a no-op when no input is mounted', () => {
    const { result } = setup();
    expect(() => act(() => result.current.open())).not.toThrow();
  });

  it('names the missing mode, because a silent no-op is the whole hazard', () => {
    const { result } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => result.current.open('files'));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("getInputProps('files')"));
  });
});

/**
 * The load-bearing guarantee of the second picker: a selection is not a second
 * input path with rules of its own. `filePath()` falls back to `file.name` when
 * the browser set no `webkitRelativePath` — which is exactly what the drop
 * handler writes for a root file — so both arrive at the same pipeline with the
 * same paths, and every rule downstream is source-blind.
 */
describe('a picked file set deploys identically to a dropped one', () => {
  // Fresh Files per run: `stripCommonPrefix` mutates `webkitRelativePath`, so
  // reusing instances would let the first run decide the second's paths.
  const flatSite = () => [
    file('index.html', '<html><body>hi</body></html>', 'text/html'),
    file('style.css', 'body{margin:0}', 'text/css'),
  ];

  const observable = (drop: DropReturn) => ({
    phase: drop.phase,
    sourceName: drop.sourceName,
    needsBuild: drop.needsBuild,
    status: drop.status,
    deployPaths: drop.validFiles.map((f) => f.path).sort(),
    // What Ship actually reads off the raw File objects
    uploadPaths: drop
      .getFilesForUpload()
      .map((f) => f.webkitRelativePath)
      .sort(),
  });

  const pick = async (files: File[]) => {
    const { result } = setup();
    await act(async () => {
      result.current.getInputProps('files').onChange(inputChangeEvent(files));
    });
    return observable(result.current);
  };

  const drop = async (files: File[]) => {
    const { result } = setup();
    await act(async () => {
      await result.current
        .getDropzoneProps()
        .onDrop(dropEvent({ items: files.map((f) => dataTransferItem({ asFile: f })) }));
    });
    return observable(result.current);
  };

  it('agrees on loose web files', async () => {
    const picked = await pick(flatSite());

    expect(picked).toEqual(await drop(flatSite()));
    expect(picked.deployPaths).toEqual(['index.html', 'style.css']);
    expect(picked.uploadPaths).toEqual(['index.html', 'style.css']);
  });

  it('agrees on a single ZIP — extracted either way', async () => {
    const archive = () => [
      zipOf({ 'index.html': '<html>hi</html>', 'assets/app.js': 'console.log(1)' }, 'my-site.zip'),
    ];
    const picked = await pick(archive());

    expect(picked).toEqual(await drop(archive()));
    expect(picked.sourceName).toBe('my-site');
    expect(picked.deployPaths).toEqual(['assets/app.js', 'index.html']);
  });

  it('agrees on a rejection — a blocked extension fails the same way', async () => {
    const withExe = () => [
      file('index.html', '<html>hi</html>', 'text/html'),
      file('setup.exe', 'MZ'),
    ];
    const picked = await pick(withExe());

    // The picker's `accept` hint is not the gate; `validateFiles` is, and it is
    // downstream of BOTH entry points. Drag-and-drop ignores `accept` outright,
    // so any divergence here would be a rule the two paths did not share.
    expect(picked).toEqual(await drop(withExe()));
    expect(picked.phase).toBe('error');
    expect(picked.status?.errors?.join()).toContain('setup.exe');
  });

  it('agrees that a set with no root index.html is not deployable', async () => {
    const noEntry = () => [file('style.css', 'body{}', 'text/css')];
    const picked = await pick(noEntry());

    expect(picked).toEqual(await drop(noEntry()));
    expect(picked.phase).toBe('error');
  });
});
