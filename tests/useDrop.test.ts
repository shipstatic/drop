import type { Ship } from '@shipstatic/ship';
import { FileValidationStatus } from '@shipstatic/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type DropOptions, useDrop } from '../src/useDrop';
import {
  builtSite,
  dataTransferItem,
  dropEvent,
  fileAt,
  fileEntry,
  GENEROUS_LIMITS,
  heldDirEntry,
  heldZip,
  PLATFORM_LIMITS,
  shipStub,
  zipOf,
} from './fixtures/builders';

/**
 * The `ship` instance is hoisted out of the render callback deliberately: an
 * inline `shipStub()` would be a NEW object every render, invalidating every
 * `useCallback` that depends on it. Consumers pass a stable client, so the tests
 * do too.
 */
const setup = (options: Partial<DropOptions> = {}) => {
  const ship = options.ship ?? shipStub();
  return renderHook(() => useDrop({ ...options, ship }));
};

/**
 * A Ship whose `getLimits()` blocks until released — the seam that makes the
 * transient `processing` phase observable. Without it, `act()` flushes the whole
 * async run and a render-tracking callback only ever sees idle → ready.
 */
function gatedShip(limits = GENEROUS_LIMITS) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ship = {
    getLimits: async () => {
      await gate;
      return limits;
    },
  } as unknown as Ship;
  return { ship, release };
}

describe('useDrop — initial state', () => {
  it('starts idle and interactive with nothing held', () => {
    const { result } = setup();

    expect(result.current.phase).toBe('idle');
    expect(result.current.isDragging).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isInteractive).toBe(true);
    expect(result.current.hasError).toBe(false);
    expect(result.current.files).toEqual([]);
    expect(result.current.validFiles).toEqual([]);
    expect(result.current.sourceName).toBe('');
    expect(result.current.status).toBeNull();
    expect(result.current.needsBuild).toBe(false);
  });
});

describe('useDrop — processing a set', () => {
  it('lands in ready with files, source name and status', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('dist'));
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isInteractive).toBe(true);
    expect(result.current.files).toHaveLength(2);
    expect(result.current.validFiles).toHaveLength(2);
    expect(result.current.sourceName).toBe('dist');
    expect(result.current.status?.title).toBe('Ready');
  });

  it('lands in error when validation fails', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([fileAt('app.js', 'x')]);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.hasError).toBe(true);
    expect(result.current.isInteractive).toBe(false);
    expect(result.current.status?.title).toBe("Can't deploy this");
  });

  it('is processing, and not interactive, while the run is in flight', async () => {
    const { ship, release } = gatedShip();
    const { result } = setup({ ship });

    let run!: Promise<void>;
    await act(async () => {
      run = result.current.processFiles(builtSite());
    });

    expect(result.current.phase).toBe('processing');
    expect(result.current.isProcessing).toBe(true);
    expect(result.current.isInteractive).toBe(false);
    expect(result.current.status?.title).toBe('Processing...');

    await act(async () => {
      release();
      await run;
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.isProcessing).toBe(false);
  });

  it('clears any previous files the moment processing starts', async () => {
    const { ship, release } = gatedShip();
    const { result } = setup({ ship });

    let run!: Promise<void>;
    await act(async () => {
      run = result.current.processFiles(builtSite('dist'));
    });

    expect(result.current.files).toEqual([]);
    expect(result.current.sourceName).toBe('');

    await act(async () => {
      release();
      await run;
    });
  });

  it('clears a previous set before processing a new one', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('first'));
    });
    await act(async () => {
      await result.current.processFiles([fileAt('second/index.html', '<html>', 'text/html')]);
    });

    expect(result.current.files).toHaveLength(1);
    expect(result.current.sourceName).toBe('second');
  });

  it('ignores an empty file list', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([]);
    });

    expect(result.current.phase).toBe('idle');
  });
});

describe('useDrop — re-entry guard', () => {
  it('ignores a second call while the first is in flight', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup();

    await act(async () => {
      await Promise.all([
        result.current.processFiles(builtSite('first')),
        result.current.processFiles(builtSite('second')),
      ]);
    });

    expect(warn).toHaveBeenCalledWith(
      'File processing already in progress. Ignoring duplicate call.',
    );
    expect(result.current.sourceName).toBe('first');
  });

  it('releases the guard after a failure, so a retry works', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([fileAt('app.js', 'x')]);
    });
    expect(result.current.phase).toBe('error');

    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    expect(result.current.phase).toBe('ready');
  });
});

describe('useDrop — limits come from the Ship instance', () => {
  it('validates against the limits the client reports', async () => {
    const { result } = setup({ ship: shipStub({ ...PLATFORM_LIMITS, maxFileSize: 10 }) });

    await act(async () => {
      await result.current.processFiles([
        fileAt('index.html', '<html>', 'text/html'),
        fileAt('big.txt', 'x'.repeat(50)),
      ]);
    });

    expect(result.current.phase).toBe('error');
  });

  it('fetches limits on every run, so a plan change is picked up', async () => {
    const getLimits = vi.fn().mockResolvedValue(GENEROUS_LIMITS);
    const { result } = setup({ ship: { getLimits } as never });

    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    await act(async () => {
      await result.current.processFiles(builtSite());
    });

    expect(getLimits).toHaveBeenCalledTimes(2);
  });
});

describe('useDrop — needsBuild', () => {
  it('surfaces the signal for an unbuilt project', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([
        fileAt('app/package.json', '{}'),
        fileAt('app/index.html', '<html>', 'text/html'),
      ]);
    });

    expect(result.current.needsBuild).toBe(true);
    expect(result.current.phase).toBe('ready');
  });

  it('is false for a built site', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    expect(result.current.needsBuild).toBe(false);
  });
});

describe('useDrop — helpers', () => {
  it('validFiles holds only READY files', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([
        fileAt('index.html', '<html>', 'text/html'),
        fileAt('empty.txt', ''),
      ]);
    });

    expect(result.current.files).toHaveLength(2);
    expect(result.current.validFiles.map((f) => f.path)).toEqual(['index.html']);
    expect(result.current.validFiles.every((f) => f.status === FileValidationStatus.READY)).toBe(
      true,
    );
  });

  it('getFilesForUpload returns the raw File objects of the valid set', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('dist'));
    });

    const forUpload = result.current.getFilesForUpload();
    expect(forUpload).toHaveLength(2);
    expect(forUpload.every((f) => f instanceof File)).toBe(true);
    // The stripped deploy path rides on the File, which is what the SDK reads
    expect(forUpload.map((f) => f.webkitRelativePath).sort()).toEqual(['app.js', 'index.html']);
  });

  it('getFilesForUpload is empty before anything is processed', () => {
    expect(setup().result.current.getFilesForUpload()).toEqual([]);
  });
});

describe('useDrop — reset', () => {
  it('returns to the initial state', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('dist'));
    });
    act(() => result.current.reset());

    expect(result.current.phase).toBe('idle');
    expect(result.current.files).toEqual([]);
    expect(result.current.sourceName).toBe('');
    expect(result.current.status).toBeNull();
    expect(result.current.needsBuild).toBe(false);
  });

  it('clears an error state', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([fileAt('app.js', 'x')]);
    });
    act(() => result.current.reset());

    expect(result.current.hasError).toBe(false);
    expect(result.current.isInteractive).toBe(true);
  });

  it('allows processing again afterwards', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite());
    });
    act(() => result.current.reset());
    await act(async () => {
      await result.current.processFiles(builtSite('again'));
    });

    await waitFor(() => expect(result.current.sourceName).toBe('again'));
  });
});

/**
 * Preparation is asynchronous and can be cancelled, so a run has a lifetime of
 * its own: it may fail before it starts, and it may still be working after the
 * person has moved on. Both ends are held here, because the second one ends
 * with somebody uploading files they did not choose.
 */
describe('useDrop — a run’s lifetime', () => {
  /** A client whose every limits read waits for its own release, and sees its own signal. */
  function queuedShip() {
    const reads: { release: () => void; fail: (error: Error) => void; signal?: AbortSignal }[] = [];
    const ship = {
      getLimits: ({ signal }: { signal?: AbortSignal } = {}) =>
        new Promise((resolve, reject) => {
          reads.push({ release: () => resolve(GENEROUS_LIMITS), fail: reject, signal });
        }),
    } as unknown as Ship;
    return { ship, reads };
  }

  it('says so when the limits cannot be read, and is ready to try again', async () => {
    const getLimits = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error. Check your connection.'))
      .mockResolvedValue(GENEROUS_LIMITS);
    const { result } = setup({ ship: { getLimits } as never });

    await act(async () => {
      await result.current.processFiles(builtSite());
    });

    // Never left on "Processing...": the failure is the state.
    expect(result.current.phase).toBe('error');
    expect(result.current.status).toEqual({
      title: "Couldn't prepare the files",
      details: 'Network error. Check your connection.',
    });

    await act(async () => {
      await result.current.processFiles(builtSite('retry'));
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('retry');
  });

  it('a cancelled run never replaces the selection made after it', async () => {
    const { ship, reads } = queuedShip();
    const { result } = setup({ ship });

    // The first selection is still preparing when it is cancelled.
    let first!: Promise<void>;
    act(() => {
      first = result.current.processFiles(builtSite('wrong-folder'));
    });
    act(() => result.current.reset());

    // The second is selected and finishes.
    let second!: Promise<void>;
    act(() => {
      second = result.current.processFiles(builtSite('right-folder'));
    });
    await act(async () => {
      reads[1]?.release();
      await second;
    });
    expect(result.current.sourceName).toBe('right-folder');

    // Only now does the first one's read come back.
    await act(async () => {
      reads[0]?.release();
      await first;
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('right-folder');
  });

  it('a cancelled run finishing does not free the run that replaced it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ship, reads } = queuedShip();
    const { result } = setup({ ship });

    let first!: Promise<void>;
    act(() => {
      first = result.current.processFiles(builtSite('first'));
    });
    act(() => result.current.reset());
    act(() => {
      void result.current.processFiles(builtSite('second'));
    });

    // The cancelled run ends while the second is still in flight.
    await act(async () => {
      reads[0]?.release();
      await first;
    });

    // The guard is still the second run's: a third selection is ignored.
    await act(async () => {
      await result.current.processFiles(builtSite('third'));
    });
    expect(warn).toHaveBeenCalledWith(
      'File processing already in progress. Ignoring duplicate call.',
    );
    expect(result.current.phase).toBe('processing');
  });

  it('a cancelled archive still inflating never replaces the selection made after it', async () => {
    const { result } = setup();
    const wrong = heldZip({ 'index.html': '<html>' }, 'wrong.zip');

    // The limits are read and the pipeline is inside the archive when the
    // run is cancelled: nothing can stop it there.
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.processFiles([wrong.zip]);
    });
    expect(result.current.status?.title).toBe('Extracting...');
    act(() => result.current.reset());

    await act(async () => {
      await result.current.processFiles(builtSite('right-folder'));
    });
    const chosen = result.current.status;

    await act(async () => {
      wrong.release();
      await first;
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('right-folder');
    expect(result.current.status).toEqual(chosen);
  });

  it('cancelling stops the limits read, and its rejection says nothing', async () => {
    const { ship, reads } = queuedShip();
    const { result } = setup({ ship });

    let run!: Promise<void>;
    act(() => {
      run = result.current.processFiles(builtSite());
    });
    expect(reads[0]?.signal?.aborted).toBe(false);

    act(() => result.current.reset());
    expect(reads[0]?.signal?.aborted).toBe(true);

    // The client rejects an aborted read; that is the cancel, not an error.
    await act(async () => {
      reads[0]?.fail(new DOMException('The operation was aborted.', 'AbortError'));
      await run;
    });
    expect(result.current.phase).toBe('idle');
    expect(result.current.status).toBeNull();
  });
});

/**
 * A dropped folder is read before its files exist, and that read is part of
 * the run: the selection was made at the drop. These go through the dropzone's
 * own handler, since `processFiles` starts after the files are in hand.
 */
describe('useDrop — a dropped folder is a run from the drop', () => {
  const folder = (name: string) => {
    const held = heldDirEntry(name, [fileEntry('index.html', '<html>')]);
    return { ...held, event: dropEvent({ items: [dataTransferItem({ entry: held.entry })] }) };
  };

  it('is processing while the folder is read, and a second selection waits its turn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup();
    const dropped = folder('site');

    let drop!: Promise<void>;
    act(() => {
      drop = result.current.getDropzoneProps().onDrop(dropped.event) as unknown as Promise<void>;
    });
    expect(result.current.phase).toBe('processing');

    await act(async () => {
      await result.current.processFiles(builtSite('other'));
    });
    expect(warn).toHaveBeenCalledWith(
      'File processing already in progress. Ignoring duplicate call.',
    );

    await act(async () => {
      dropped.release();
      await drop;
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('site');
  });

  it('a folder still being read when it is cancelled never replaces the next selection', async () => {
    const { result } = setup();
    const wrong = folder('wrong-folder');

    let drop!: Promise<void>;
    act(() => {
      drop = result.current.getDropzoneProps().onDrop(wrong.event) as unknown as Promise<void>;
    });
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');

    await act(async () => {
      await result.current.processFiles(builtSite('right-folder'));
    });
    expect(result.current.sourceName).toBe('right-folder');

    // Only now does the browser finish reading the first folder.
    await act(async () => {
      wrong.release();
      await drop;
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('right-folder');
  });

  it('a folder with nothing in it says so, and frees the next selection', async () => {
    const { result } = setup();
    const empty = heldDirEntry('empty', []);

    await act(async () => {
      // A browser lists a dropped folder in `dataTransfer.files` too, as an
      // entry that is not a file. It is never what gets prepared.
      const drop = result.current.getDropzoneProps().onDrop(
        dropEvent({
          items: [dataTransferItem({ entry: empty.entry })],
          files: [new File([], 'empty')],
        }),
      );
      empty.release();
      await drop;
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.status).toEqual({
      title: "Can't deploy this",
      details: 'The folder has no files.',
    });
    expect(result.current.files).toEqual([]);

    await act(async () => {
      await result.current.processFiles(builtSite('next'));
    });
    expect(result.current.sourceName).toBe('next');
  });

  it('a cancelled folder that turns out empty does not clear the next selection', async () => {
    const { result } = setup();
    const empty = heldDirEntry('empty', []);

    let drop!: Promise<void>;
    act(() => {
      drop = result.current
        .getDropzoneProps()
        .onDrop(
          dropEvent({ items: [dataTransferItem({ entry: empty.entry })] }),
        ) as unknown as Promise<void>;
    });
    act(() => result.current.reset());
    await act(async () => {
      await result.current.processFiles(builtSite('kept'));
    });

    await act(async () => {
      empty.release();
      await drop;
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('kept');
  });

  it('a drop that carries no files leaves the current selection alone', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.processFiles(builtSite('kept'));
    });

    await act(async () => {
      await result.current
        .getDropzoneProps()
        .onDrop(dropEvent({ items: [dataTransferItem({ kind: 'string' })] }));
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('kept');
  });
});

describe('useDrop — deploy paths', () => {
  it('strips the shared root folder from every path', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles(builtSite('my-site'));
    });

    expect(result.current.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });
});

describe('useDrop — ZIP input', () => {
  it('extracts a dropped archive and surfaces its contents', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.processFiles([
        zipOf({ 'dist/index.html': '<html>hi</html>', 'dist/app.js': 'x' }, 'my-site.zip'),
      ]);
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.sourceName).toBe('my-site');
    expect(result.current.files.map((f) => f.path).sort()).toEqual(['app.js', 'index.html']);
  });

  it('shows the pipeline’s extraction status while inflating', async () => {
    // The hook forwards `onStatus` into state; extraction is the only step that
    // reports, so this is what wires the two together.
    const { ship, release } = gatedShip();
    const { result } = setup({ ship });
    const titles: string[] = [];

    let run!: Promise<void>;
    await act(async () => {
      run = result.current.processFiles([zipOf({ 'index.html': '<html>' }, 'site.zip')]);
    });
    titles.push(result.current.status?.title ?? '');

    await act(async () => {
      release();
      await run;
    });

    expect(titles).toEqual(['Processing...']);
    expect(result.current.phase).toBe('ready');
  });
});
