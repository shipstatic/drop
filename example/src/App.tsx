import { useState } from 'react';
import { useDrop } from '@shipstatic/drop';
import Ship from '@shipstatic/ship';

const ship = new Ship({
  // deployToken: 'token-here'
});

function App() {
  const [deploymentUrl, setDeploymentUrl] = useState('');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  const drop = useDrop({ ship });

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          await traverseFileTree(entry, files, entry.isDirectory ? entry.name : '');
        }
      }
    }

    if (files.length > 0) {
      drop.processFiles(files);
    }
  };

  const traverseFileTree = async (entry: FileSystemEntry, files: File[], currentPath = ''): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      const relativePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath,
        writable: false,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      let allEntries: FileSystemEntry[] = [];

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

      for (const childEntry of allEntries) {
        const entryPath = currentPath ? `${currentPath}/${childEntry.name}` : childEntry.name;
        await traverseFileTree(childEntry, files, entryPath);
      }
    }
  };

  const handleDeploy = async () => {
    setError('');
    setDeploymentUrl('');
    setIsDeploying(true);

    try {
      const validFiles = drop.getValidFiles();
      const files = validFiles.map(f => f.file);
      const result = await ship.deployments.create(files);
      setDeploymentUrl(result.url);
    } catch (err: any) {
      setError(err.message || 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  const validCount = drop.getValidFiles().length;

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>Drop + Ship</h1>

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
        style={{
          border: `2px dashed ${isDragging ? '#0066cc' : '#ccc'}`,
          padding: '3rem',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: '1.5rem',
          backgroundColor: isDragging ? '#f0f9ff' : 'white',
        }}
      >
        <input
          type="file"
          {...({ webkitdirectory: '' } as any)}
          multiple
          onChange={(e) => {
            const fileList = Array.from(e.target.files || []);
            drop.processFiles(fileList);
          }}
          style={{ display: 'none' }}
          id="file-input"
        />
        <div style={{ pointerEvents: 'none' }}>
          {isDragging ? '📂 Drop here' : '📁 Drop files/folders or click'}
        </div>
      </div>

      {/* Source name */}
      {drop.sourceName && (
        <p style={{ fontSize: '1.1rem', fontWeight: 500, margin: '0 0 0.5rem 0' }}>
          {drop.sourceName}
        </p>
      )}

      {/* Status - only show during processing */}
      {drop.isProcessing && drop.statusText && (
        <p style={{ margin: '0 0 1rem 0' }}>
          {drop.statusText}
        </p>
      )}

      {/* Validation error */}
      {drop.validationError && (
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          padding: '1rem',
          marginBottom: '1rem',
          borderRadius: '4px'
        }}>
          <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: '0.5rem' }}>
            {drop.validationError.error}
          </div>
          <div style={{ color: '#dc2626', fontSize: '0.9rem' }}>
            {drop.validationError.details}
          </div>
        </div>
      )}

      {/* Files count - only show when ready (not processing, no validation errors) */}
      {drop.files.length > 0 && !drop.isProcessing && !drop.validationError && (
        <p style={{ margin: '0 0 1rem 0' }}>
          {validCount} file{validCount !== 1 ? 's' : ''} ready.
        </p>
      )}

      {/* Actions */}
      {drop.files.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            onClick={handleDeploy}
            disabled={validCount === 0 || drop.isProcessing || isDeploying || !!deploymentUrl}
            style={{
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              cursor: validCount === 0 || drop.isProcessing || isDeploying || deploymentUrl ? 'not-allowed' : 'pointer',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: validCount === 0 || drop.isProcessing || isDeploying || deploymentUrl ? '#ccc' : '#0066cc',
              color: 'white',
              fontWeight: 500,
            }}
          >
            {drop.isProcessing ? 'Processing...' : isDeploying ? 'Deploying...' : deploymentUrl ? 'Deployed ✓' : 'Deploy'}
          </button>
          <button
            onClick={() => {
              drop.clearAll();
              setDeploymentUrl('');
              setError('');
              setIsDeploying(false);
            }}
            style={{
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: '4px',
              backgroundColor: 'white',
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Deployment success */}
      {deploymentUrl && (
        <div style={{
          backgroundColor: '#f0fdf4',
          border: '1px solid #bbf7d0',
          padding: '1rem',
          borderRadius: '4px',
        }}>
          <div style={{ fontWeight: 600, color: '#166534', marginBottom: '0.5rem' }}>
            Deployed successfully
          </div>
          <a
            href={deploymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0066cc', wordBreak: 'break-all' }}
          >
            {deploymentUrl}
          </a>
        </div>
      )}

      {/* Deployment error */}
      {error && !drop.validationError && (
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          padding: '1rem',
          borderRadius: '4px',
          color: '#991b1b',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
