/**
 * @shipstatic/assets Demo
 * Demonstrates the headless dropzone hook with custom UI components
 */
import { useState } from 'react';
import { useDropzoneManager } from '@shipstatic/assets';
import { CustomDropzone } from './components/CustomDropzone';
import { FileListDisplay } from './components/FileListDisplay';

function App() {
  const [showRawData, setShowRawData] = useState(false);

  const dropzone = useDropzoneManager({
    // Using default Ship SDK validation config
    // In production, get config from: await ship.getConfig()
    onValidationError: (error) => {
      console.error('Validation Error:', error);
    },
    onFilesReady: (files) => {
      console.log('Files Ready:', files);
    },
  });

  const validFiles = dropzone.getValidFiles();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            @shipstatic/assets Demo
          </h1>
          <p className="text-gray-600">
            Headless React hook with custom UI - Folder structure preservation, ZIP extraction, and validation
          </p>
        </div>

        {/* Info Badge */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900 mb-1">
                This demo uses a custom dropzone implementation
              </p>
              <p className="text-xs text-blue-700">
                The UI components you see here are built from scratch to demonstrate how <code className="px-1 py-0.5 bg-blue-100 rounded">@shipstatic/assets</code> provides the logic while you control the UI. This approach preserves folder structure using modern browser APIs.
              </p>
            </div>
          </div>
        </div>

        {/* Custom Dropzone */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Drop Files or Folders
          </h2>
          <CustomDropzone
            onFilesSelected={dropzone.processFiles}
            disabled={dropzone.isProcessing}
          />

          {/* Status Text */}
          {dropzone.statusText && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-blue-800 text-sm">
              <strong>Status:</strong> {dropzone.statusText}
            </div>
          )}

          {/* Validation Error */}
          {dropzone.validationError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              <strong>Error:</strong> {dropzone.validationError.details}
            </div>
          )}

          {/* Processing Indicator */}
          {dropzone.isProcessing && (
            <div className="mt-4 flex items-center gap-2 text-blue-600">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Processing files...</span>
            </div>
          )}
        </div>

        {/* File List */}
        {dropzone.files.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Processed Files ({dropzone.files.length})
              </h2>
              <button
                onClick={dropzone.clearAll}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
              >
                Clear All
              </button>
            </div>
            <FileListDisplay files={dropzone.files} onRemove={dropzone.removeFile} />
          </div>
        )}

        {/* Valid Files Summary */}
        {validFiles.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Ready for Upload ({validFiles.length} files)
            </h2>
            <div className="space-y-2">
              {validFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-green-900 truncate">
                      {file.path}
                    </p>
                    <p className="text-sm text-green-700">
                      {(file.size / 1024).toFixed(2)} KB • {file.type}
                    </p>
                    {file.md5 && (
                      <p className="text-xs text-green-600 font-mono mt-1">
                        MD5: {file.md5}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Mock Upload Button */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <button
                onClick={() => {
                  // ProcessedFile extends StaticFile - no conversion needed!
                  // validFiles can be passed directly to ship.deployments.create({ files: validFiles })
                  console.log('Ship SDK compatible format (no conversion needed!):', validFiles);
                  alert(`Would upload ${validFiles.length} files. Check console for Ship SDK format.`);
                }}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Ready to Upload {validFiles.length} {validFiles.length === 1 ? 'File' : 'Files'}
              </button>
              <p className="mt-2 text-sm text-gray-500 text-center">
                This is a demo - no actual upload happens. ProcessedFile extends StaticFile, so validFiles can be passed directly to the SDK!
              </p>
            </div>
          </div>
        )}

        {/* Raw Data Inspector */}
        {validFiles.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Raw Data Inspector
              </h2>
              <button
                onClick={() => setShowRawData(!showRawData)}
                className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
              >
                {showRawData ? 'Hide' : 'Show'} JSON
              </button>
            </div>
            {showRawData && (
              <pre className="bg-gray-900 text-green-400 p-4 rounded overflow-auto max-h-96 text-xs">
                {JSON.stringify(
                  validFiles.map(f => ({
                    id: f.id,
                    name: f.name,
                    path: f.path,
                    size: f.size,
                    type: f.type,
                    status: f.status,
                    md5: f.md5,
                    lastModified: new Date(f.lastModified).toISOString(),
                  })),
                  null,
                  2
                )}
              </pre>
            )}
          </div>
        )}

        {/* Info Panel */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">
            What's happening behind the scenes?
          </h3>
          <ul className="space-y-2 text-gray-600 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span><strong>Folder Structure:</strong> Using File System Access API (Chrome 86+) with webkit fallback for broader browser support</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span><strong>ZIP Extraction:</strong> Automatically detects and extracts ZIP archives, preserving internal folder structure</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span><strong>Validation:</strong> Client-side checks for file size (5MB max), count (100 max), and total size (25MB max)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span><strong>Junk Filtering:</strong> Automatically removes .DS_Store, Thumbs.db, and other system files</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span><strong>MD5 Hashing:</strong> Calculates checksums for all files (required by Ship SDK)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">•</span>
              <span><strong>Path Normalization:</strong> Strips common directory prefix and sanitizes paths</span>
            </li>
          </ul>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              <strong>Architecture:</strong> This demo uses <code className="px-1 py-0.5 bg-gray-100 rounded">useDropzoneManager</code> hook for file processing logic,
              while <code className="px-1 py-0.5 bg-gray-100 rounded">CustomDropzone</code> and <code className="px-1 py-0.5 bg-gray-100 rounded">FileListDisplay</code> provide
              the UI. This separation gives you complete control over styling and behavior.
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              <strong>Note:</strong> This demo doesn't actually upload files anywhere.
              It only demonstrates the file preparation capabilities of @shipstatic/assets.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
