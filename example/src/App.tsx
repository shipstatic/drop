import { useState } from 'react';
import { useDropzoneManager } from '@shipstatic/drop';
import Ship from '@shipstatic/ship';

const ship = new Ship({
  // deployToken: 'token-here'
});

function App() {
  const [deploymentUrl, setDeploymentUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const dropzone = useDropzoneManager();

  const handleDeploy = async () => {
    const validFiles = dropzone.getValidFiles();
    const files = validFiles.map(f => f.file);
    const result = await ship.deployments.create(files);
    setDeploymentUrl(result.url);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          // For directories, start the path with the directory name
          // For files, start with empty path (just the filename)
          const initialPath = entry.isDirectory ? entry.name : '';
          await traverseFileTree(entry, files, initialPath);
        }
      }
    }

    if (files.length > 0) {
      dropzone.processFiles(files);
    }
  };

  const traverseFileTree = async (entry: FileSystemEntry, files: File[], currentPath = ''): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      // Add webkitRelativePath to preserve folder structure
      const relativePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath,
        writable: false,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      let allEntries: FileSystemEntry[] = [];

      // readEntries returns batches of max 100 entries
      // We need to call it repeatedly until it returns an empty array
      const readEntriesBatch = async (): Promise<void> => {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        });
        if (batch.length > 0) {
          allEntries = allEntries.concat(batch);
          await readEntriesBatch();
        }
      };
      await readEntriesBatch();

      // Process all entries
      for (const childEntry of allEntries) {
        const entryPath = currentPath ? `${currentPath}/${childEntry.name}` : childEntry.name;
        await traverseFileTree(childEntry, files, entryPath);
      }
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>@shipstatic/drop + @shipstatic/ship</h1>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        style={{
          border: `2px dashed ${isDragging ? '#0066cc' : '#ccc'}`,
          padding: '2rem',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '1rem',
        }}
      >
        <input
          type="file"
          {...({ webkitdirectory: '' } as any)}
          multiple
          onChange={(e) => dropzone.processFiles(Array.from(e.target.files || []))}
          style={{ display: 'none' }}
          id="file-input"
        />
        <div style={{ pointerEvents: 'none' }}>
          {isDragging ? 'Drop files here...' : 'Drag files/folders here or click to select'}
        </div>
      </div>

      {dropzone.statusText && <p>{dropzone.statusText}</p>}
      {dropzone.validationError && <p style={{ color: 'red' }}>{dropzone.validationError.details}</p>}

      {dropzone.files.length > 0 && (
        <>
          <p>{dropzone.files.length} files processed, {dropzone.getValidFiles().length} ready</p>
          <button onClick={handleDeploy} disabled={dropzone.getValidFiles().length === 0}>
            Deploy
          </button>
        </>
      )}

      {deploymentUrl && <p>✓ <a href={deploymentUrl} target="_blank" rel="noopener noreferrer">{deploymentUrl}</a></p>}
    </div>
  );
}

export default App;
