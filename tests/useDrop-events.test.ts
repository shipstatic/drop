import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    // Always a folder picker — individual files arrive by drag & drop
    expect(props.webkitdirectory).toBe('');
    expect(props.ref).toBeDefined();
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
  it('clicks the input the ref is attached to', () => {
    const { result } = setup();
    const input = document.createElement('input');
    const click = vi.spyOn(input, 'click');

    // Simulate React attaching the ref
    (result.current.getInputProps().ref as { current: HTMLInputElement | null }).current = input;
    act(() => result.current.open());

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no input is mounted', () => {
    const { result } = setup();
    expect(() => act(() => result.current.open())).not.toThrow();
  });
});
