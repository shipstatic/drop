import { useState } from 'react';
import { useDrop } from '@shipstatic/drop';
import Ship from '@shipstatic/ship';

const ship = new Ship({
  // deployToken: 'token-here'
});

function App() {
  const [deploymentUrl, setDeploymentUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [source, setSource] = useState('');

  const drop = useDrop({
    // Pass Ship instance - Drop will use ship.getConfig() for validation
    ship
  });

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      const validFiles = drop.getValidFiles();
      // Pass File[] to Ship SDK - it will calculate MD5 during deployment
      const files = validFiles.map(f => f.file);
      const result = await ship.deployments.create(files);
      setDeploymentUrl(result.url);
    } catch (error) {
      console.error('Deployment failed:', error);
      setIsDeploying(false);
    }
  };

  const handleDemoErrors = () => {
    // Create demo files with intentional validation errors
    const demoFiles = [
      // Valid file
      new File(['<!DOCTYPE html><html><body>Valid</body></html>'], 'index.html', { type: 'text/html' }),

      // Invalid: Path traversal
      new File(['malicious content'], '../../../etc/passwd', { type: 'text/plain' }),

      // Valid file
      new File(['body { margin: 0; }'], 'style.css', { type: 'text/css' }),

      // Invalid: Unsafe characters in filename
      new File(['content'], 'file?.txt', { type: 'text/plain' }),

      // Invalid: Extension doesn't match MIME type (disguised executable)
      new File(['fake image'], 'image.jpg', { type: 'application/x-msdownload' }),

      // Valid file
      new File(['console.log("app");'], 'app.js', { type: 'application/javascript' }),

      // Invalid: Disallowed MIME type
      new File(['binary data'], 'app.wasm', { type: 'application/wasm' }),
    ];

    setSource('Demo: Validation Errors');
    drop.processFiles(demoFiles);
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
          if (items.length === 1) setSource(entry.name);
          const initialPath = entry.isDirectory ? entry.name : '';
          await traverseFileTree(entry, files, initialPath);
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
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files[0]?.webkitRelativePath) setSource(files[0].webkitRelativePath.split('/')[0]);
            drop.processFiles(files);
          }}
          style={{ display: 'none' }}
          id="file-input"
        />
        <div style={{ pointerEvents: 'none' }}>
          {isDragging ? 'Drop files here...' : 'Drag files/folders here or click to select'}
        </div>
      </div>

      <button
        onClick={handleDemoErrors}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '0.9rem',
          cursor: 'pointer',
          border: '1px solid #0066cc',
          borderRadius: '4px',
          backgroundColor: 'white',
          color: '#0066cc',
          marginBottom: '1rem',
          width: '100%',
        }}
      >
        🔍 Demo: Show Granular Error Reporting
      </button>

      {source && <p><strong>{source}</strong></p>}
      {drop.statusText && <p>{drop.statusText}</p>}

      {drop.validationError && (
        <div style={{
          backgroundColor: '#fef2f2',
          border: '2px solid #fecaca',
          borderRadius: '6px',
          padding: '1rem',
          marginBottom: '1rem'
        }}>
          <div style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: '#991b1b',
            marginBottom: '0.5rem'
          }}>
            ❌ {drop.validationError.error}
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: '#dc2626',
            marginBottom: '0.75rem'
          }}>
            {drop.validationError.details}
          </div>
          {drop.validationError.errors && drop.validationError.errors.length > 1 && (
            <div style={{
              fontSize: '0.85rem',
              color: '#7f1d1d',
              paddingTop: '0.5rem',
              borderTop: '1px solid #fecaca'
            }}>
              <strong>All errors:</strong>
              <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                {drop.validationError.errors.map((err: string, i: number) => (
                  <li key={i} style={{ marginBottom: '0.25rem' }}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {drop.files.length > 0 && (
        <>
          <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
            <h3>Files ({drop.files.length})</h3>
            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              border: '1px solid #ccc',
              borderRadius: '4px',
              padding: '0.5rem'
            }}>
              {drop.files.map(file => (
                <div
                  key={file.id}
                  style={{
                    padding: '0.75rem',
                    marginBottom: '0.5rem',
                    backgroundColor: file.status === 'ready' ? '#f0f9ff' : '#fff1f2',
                    borderRadius: '4px',
                    border: file.status === 'ready' ? '1px solid #bae6fd' : '2px solid #fecaca'
                  }}
                >
                  <div style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: file.status === 'ready' ? '#0369a1' : '#991b1b'
                  }}>
                    <span style={{ fontSize: '1.1rem', marginRight: '0.5rem' }}>
                      {file.status === 'ready' ? '✓' : '✗'}
                    </span>
                    {file.path}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>
                    {(file.size / 1024).toFixed(1)} KB · {file.type}
                  </div>
                  {/* Show per-file error messages */}
                  {file.status !== 'ready' && file.statusMessage && (
                    <div style={{
                      fontSize: '0.875rem',
                      color: '#dc2626',
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      backgroundColor: '#fee2e2',
                      borderRadius: '4px',
                      fontWeight: 500,
                      border: '1px solid #fecaca'
                    }}>
                      ⚠️ {file.statusMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button
              onClick={handleDeploy}
              disabled={drop.getValidFiles().length === 0 || isDeploying || !!deploymentUrl}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '1rem',
                cursor: drop.getValidFiles().length === 0 || isDeploying || !!deploymentUrl ? 'not-allowed' : 'pointer',
                border: 'none',
                borderRadius: '4px',
                backgroundColor: drop.getValidFiles().length === 0 || isDeploying || !!deploymentUrl ? '#ccc' : '#0066cc',
                color: 'white',
                fontWeight: 500
              }}
            >
              {isDeploying ? 'Deploying...' : deploymentUrl ? 'Deployed' : `Deploy ${drop.getValidFiles().length} file(s)`}
            </button>
            <button
              onClick={drop.clearAll}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '1rem',
                cursor: 'pointer',
                border: '1px solid #ccc',
                borderRadius: '4px',
                backgroundColor: 'white'
              }}
            >
              Clear All
            </button>
          </div>
        </>
      )}

      {deploymentUrl && <p>✓ <a href={deploymentUrl} target="_blank" rel="noopener noreferrer">{deploymentUrl}</a></p>}
    </div>
  );
}

export default App;
