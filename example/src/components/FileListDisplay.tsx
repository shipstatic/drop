/**
 * File List Display Component
 * Shows processed files with their status, size, and actions
 */
import { ProcessedFile, FILE_STATUSES } from '@shipstatic/assets';

interface FileListDisplayProps {
  files: ProcessedFile[];
  onRemove: (fileId: string) => void;
}

export function FileListDisplay({ files, onRemove }: FileListDisplayProps) {
  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No files processed yet. Drop some files to get started!
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <FileItem key={file.id} file={file} onRemove={onRemove} />
      ))}
    </div>
  );
}

interface FileItemProps {
  file: ProcessedFile;
  onRemove: (fileId: string) => void;
}

function FileItem({ file, onRemove }: FileItemProps) {
  const getStatusColor = () => {
    switch (file.status) {
      case FILE_STATUSES.READY:
        return 'bg-green-50 border-green-200';
      case FILE_STATUSES.PENDING:
      case FILE_STATUSES.UPLOADING:
        return 'bg-blue-50 border-blue-200';
      case FILE_STATUSES.VALIDATION_FAILED:
      case FILE_STATUSES.PROCESSING_ERROR:
      case FILE_STATUSES.EMPTY_FILE:
        return 'bg-red-50 border-red-200';
      case FILE_STATUSES.COMPLETE:
        return 'bg-green-50 border-green-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = () => {
    switch (file.status) {
      case FILE_STATUSES.READY:
        return (
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case FILE_STATUSES.PENDING:
        return (
          <svg className="w-5 h-5 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        );
      case FILE_STATUSES.VALIDATION_FAILED:
      case FILE_STATUSES.PROCESSING_ERROR:
      case FILE_STATUSES.EMPTY_FILE:
        return (
          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case FILE_STATUSES.UPLOADING:
        return (
          <svg className="w-5 h-5 text-blue-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        );
      case FILE_STATUSES.COMPLETE:
        return (
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className={`flex items-start gap-3 p-3 border rounded-lg ${getStatusColor()}`}>
      {/* Status Icon */}
      <div className="flex-shrink-0 mt-0.5">{getStatusIcon()}</div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 truncate" title={file.path}>
              {file.path}
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              {formatFileSize(file.size)} • {file.type || 'unknown type'}
            </p>
          </div>

          {/* Remove Button */}
          <button
            onClick={() => onRemove(file.id)}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded transition-colors"
            title="Remove file"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Status Message */}
        {file.statusMessage && (
          <p className="text-xs text-gray-600 mt-1">{file.statusMessage}</p>
        )}

        {/* MD5 Checksum */}
        {file.md5 && file.status === FILE_STATUSES.READY && (
          <p className="text-xs text-gray-500 font-mono mt-1" title="MD5 Checksum">
            MD5: {file.md5}
          </p>
        )}

        {/* Progress Bar */}
        {file.progress !== undefined && file.progress > 0 && (
          <div className="mt-2">
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${file.progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{file.progress}%</p>
          </div>
        )}
      </div>
    </div>
  );
}
