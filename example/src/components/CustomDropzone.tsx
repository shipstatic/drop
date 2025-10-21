/**
 * Custom Dropzone Component
 * Demonstrates how to build your own dropzone with folder structure support
 * using modern browser APIs (File System Access API + webkit fallback)
 */
import { useState, useRef } from 'react';

interface CustomDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export function CustomDropzone({ onFilesSelected, disabled }: CustomDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);

    if (disabled) return;

    // Extract files with folder structure preserved
    const files = await extractFilesWithStructure(e.dataTransfer);
    onFilesSelected(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;

    const files = Array.from(e.target.files || []);
    onFilesSelected(files);

    // Reset input so the same files can be selected again
    e.target.value = '';
  };

  const extractFilesWithStructure = async (
    dataTransfer: DataTransfer
  ): Promise<File[]> => {
    const files: File[] = [];
    const items = dataTransfer.items;

    if (!items) return Array.from(dataTransfer.files);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        await processDataTransferItem(item, files);
      }
    }

    return files.length > 0 ? files : Array.from(dataTransfer.files);
  };

  const processDataTransferItem = async (
    item: DataTransferItem,
    files: File[]
  ): Promise<void> => {
    // Try modern File System Access API first (Chrome 86+)
    if (
      globalThis.isSecureContext &&
      typeof (item as any).getAsFileSystemHandle === 'function'
    ) {
      try {
        const handle = await (item as any).getAsFileSystemHandle();
        if (handle) {
          await processFileSystemHandle(handle, files, '');
          return;
        }
      } catch (err) {
        // Fall through to webkit API
      }
    }

    // Fallback to webkitGetAsEntry (broader browser support)
    const entry = (item as any).webkitGetAsEntry?.();
    if (entry) {
      await processEntry(entry, files, '');
    }
  };

  const processFileSystemHandle = async (
    handle: any,
    files: File[],
    basePath: string
  ): Promise<void> => {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      // Set webkitRelativePath for folder structure preservation
      Object.defineProperty(file, 'webkitRelativePath', {
        value: basePath + file.name,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      files.push(file);
    } else if (handle.kind === 'directory') {
      const dirPath = basePath + handle.name + '/';
      for await (const entry of handle.values()) {
        await processFileSystemHandle(entry, files, dirPath);
      }
    }
  };

  const processEntry = async (
    entry: any,
    files: File[],
    basePath: string
  ): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });
      // Set webkitRelativePath for folder structure preservation
      Object.defineProperty(file, 'webkitRelativePath', {
        value: basePath + entry.name,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const entries = await new Promise<any[]>((resolve, reject) => {
        dirReader.readEntries(resolve, reject);
      });

      for (const childEntry of entries) {
        await processEntry(childEntry, files, basePath + entry.name + '/');
      }
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragActive(true);
      }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && fileInputRef.current?.click()}
      className={`
        relative border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
        transition-all duration-200 ease-in-out
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 hover:bg-blue-50'}
        ${isDragActive ? 'border-blue-500 bg-blue-50 scale-[1.02]' : 'border-gray-300'}
      `}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        disabled={disabled}
      />

      <div className="flex flex-col items-center gap-4">
        {/* Upload Icon */}
        <svg
          className={`w-12 h-12 ${isDragActive ? 'text-blue-500' : 'text-gray-400'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>

        <div>
          <p className="text-lg font-medium text-gray-900 mb-1">
            {isDragActive ? 'Drop files here' : 'Drag & drop files or folders'}
          </p>
          <p className="text-sm text-gray-500">
            or click to browse • Supports ZIP files
          </p>
        </div>

        {/* Feature Badges */}
        <div className="flex gap-2 flex-wrap justify-center mt-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Folder Structure
          </span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            ZIP Extraction
          </span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            MD5 Hashing
          </span>
        </div>
      </div>
    </div>
  );
}
