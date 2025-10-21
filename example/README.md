# @shipstatic/dropzone Demo

A demonstration app showcasing the **headless** architecture of `@shipstatic/dropzone` with custom UI components.

## 🎯 What This Demo Shows

This demo demonstrates how to build a complete file upload experience using the `@shipstatic/dropzone` headless hook:

- ✅ **Custom Dropzone** - Built from scratch with folder structure preservation
- ✅ **Modern Browser APIs** - File System Access API + webkit fallback
- ✅ **Folder Drag & Drop** - Preserves complete folder structure via `webkitRelativePath`
- ✅ **ZIP Extraction** - Automatic extraction and processing
- ✅ **File Validation** - Size, count, and total size limits
- ✅ **MD5 Checksums** - Pre-calculated for Ship SDK
- ✅ **Path Normalization** - Sanitization and common prefix stripping
- ✅ **Junk Filtering** - Automatic removal of .DS_Store, Thumbs.db, etc.
- ✅ **Real-time Status** - Processing indicators and validation errors

**Important:** This demo does NOT upload files anywhere. It only processes and prepares files for upload.

## 🏗️ Architecture

This demo shows the **recommended pattern** for using `@shipstatic/dropzone`:

```
┌─────────────────────────────────────┐
│  @shipstatic/dropzone (headless)    │
│  • useDropzoneManager hook          │
│  • File processing logic            │
│  • ZIP extraction                   │
│  • MD5 calculation                  │
│  • Validation                       │
└─────────────────────────────────────┘
              │
              │ provides state & methods
              ▼
┌─────────────────────────────────────┐
│  Your Custom UI Components          │
│  • CustomDropzone.tsx               │
│  • FileListDisplay.tsx              │
│  • Your styling, your UX            │
└─────────────────────────────────────┘
```

### Why Custom Components?

The package is **headless by design** because:

1. **Folder structure matters** - Generic dropzone libraries (like `react-dropzone`) don't preserve `webkitRelativePath`
2. **Modern APIs required** - Proper folder drag-and-drop needs File System Access API + webkit fallbacks
3. **You control the UI** - Every project has different design requirements
4. **Smaller bundle** - No unnecessary UI dependencies

## 🚀 Running the Demo

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build
```

The demo will be available at `http://localhost:5177/` (or the next available port).

## 📦 Key Files

### Source Files

```
src/
├── App.tsx                          # Main demo application
├── components/
│   ├── CustomDropzone.tsx          # Custom dropzone with folder support
│   └── FileListDisplay.tsx         # File list display component
├── main.tsx                         # React entry point
└── index.css                        # Tailwind CSS
```

### Custom Components

#### 1. CustomDropzone.tsx (~200 lines)

Complete implementation of:
- Drag & drop with visual feedback
- Click to browse file picker
- **File System Access API** (Chrome 86+) for folder traversal
- **webkit fallback** (`webkitGetAsEntry`) for broader browser support
- Automatic `webkitRelativePath` setting for folder structure

**Key Features:**
```typescript
// Extracts files with folder structure preserved
const extractFilesWithStructure = async (dataTransfer: DataTransfer): Promise<File[]>

// Modern API with no permission prompts
const processFileSystemHandle = async (handle, files, basePath)

// Fallback for Safari, Firefox
const processEntry = async (entry, files, basePath)
```

#### 2. FileListDisplay.tsx (~200 lines)

Visual file list with:
- Status indicators (ready, processing, error, etc.)
- File size formatting
- MD5 checksum display
- Remove buttons
- Progress bars (when uploading)
- Status-specific styling

### Integration Pattern

```typescript
// App.tsx - The integration point
import { useDropzoneManager } from '@shipstatic/dropzone';
import { CustomDropzone } from './components/CustomDropzone';
import { FileListDisplay } from './components/FileListDisplay';

function App() {
  // 1. Use the headless hook
  const dropzone = useDropzoneManager({
    validation: {
      MAX_FILE_SIZE: 10 * 1024 * 1024,    // 10MB
      MAX_TOTAL_SIZE: 50 * 1024 * 1024,   // 50MB
      MAX_FILES_COUNT: 50,
    },
  });

  return (
    <>
      {/* 2. Pass methods to your custom UI */}
      <CustomDropzone
        onFilesSelected={dropzone.processFiles}
        disabled={dropzone.isProcessing}
      />

      {/* 3. Display processed files */}
      <FileListDisplay
        files={dropzone.files}
        onRemove={dropzone.removeFile}
      />

      {/* 4. Ready for Ship SDK */}
      <button onClick={() => {
        const staticFiles = dropzone.getValidFiles().map(f => ({
          content: f.file,
          path: f.path,    // Normalized path with folder structure
          md5: f.md5,      // Pre-calculated checksum
          size: f.size
        }));
        // await ship.deploy(staticFiles);
      }}>
        Upload
      </button>
    </>
  );
}
```

## 🎨 Features Demonstrated

### 1. Folder Structure Preservation

The custom dropzone uses modern browser APIs to preserve folder structure:

**File System Access API** (Chrome 86+):
- No permission prompts for drag & drop
- Full directory traversal
- Sets `webkitRelativePath` on each file

**webkit Fallback** (Safari, Firefox):
- Uses `webkitGetAsEntry()` API
- Broader browser support
- Same folder structure preservation

### 2. ZIP File Handling

- Automatic detection of ZIP files
- Extraction with folder structure preserved
- Support for nested directories
- Junk file filtering during extraction

### 3. Validation & Feedback

Configurable limits:
- **Max file size**: 10MB per file
- **Max total size**: 50MB combined
- **Max file count**: 50 files

Real-time feedback:
- Status text for current operation
- Validation error messages
- Processing indicators
- File-specific status (ready, error, etc.)

### 4. Ship SDK Integration

The demo shows how to prepare files for Ship SDK deployment:

```typescript
const validFiles = dropzone.getValidFiles();
const staticFiles = validFiles.map(f => ({
  content: f.file,    // Original File object
  path: f.path,       // Normalized path (IMPORTANT!)
  md5: f.md5,         // Pre-calculated checksum
  size: f.size
}));

// Ready for Ship SDK
await ship.deploy(staticFiles);
```

**Critical:** Always use `f.path`, never `f.file.name`. The path includes folder structure, while file.name is just the filename.

## 📝 Using This in Your Project

### Copy the Pattern

1. **Copy the custom components** (`CustomDropzone.tsx`, `FileListDisplay.tsx`)
2. **Customize the styling** to match your design system
3. **Adjust validation limits** for your use case
4. **Add upload logic** using Ship SDK or your preferred service

### Minimal Example

If you just need basic file processing without folder support:

```typescript
function MinimalDemo() {
  const dropzone = useDropzoneManager();

  return (
    <>
      <input
        type="file"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          dropzone.processFiles(files);
        }}
      />

      <div>
        {dropzone.files.map(f => (
          <div key={f.id}>{f.name} - {f.status}</div>
        ))}
      </div>

      <button
        onClick={() => console.log(dropzone.getValidFiles())}
        disabled={!dropzone.hasChecksums}
      >
        Upload {dropzone.getValidFiles().length} files
      </button>
    </>
  );
}
```

## 🔧 Configuration

The demo uses these validation limits:

```typescript
const dropzone = useDropzoneManager({
  validation: {
    MAX_FILE_SIZE: 10 * 1024 * 1024,    // 10MB per file
    MAX_TOTAL_SIZE: 50 * 1024 * 1024,   // 50MB total
    MAX_FILES_COUNT: 50,                 // 50 files max
  },
  onValidationError: (error) => {
    console.error('Validation Error:', error);
  },
  onFilesReady: (files) => {
    console.log('Files Ready:', files);
  },
  stripPrefix: true,  // Remove common directory prefix (default)
});
```

## 🧪 Testing Scenarios

Try these to see the demo in action:

1. **Drop a single file** - See basic file processing
2. **Drop a folder** - See folder structure preservation
3. **Drop a ZIP file** - See automatic extraction
4. **Drop too many files** - See validation error (51+ files)
5. **Drop a large file** - See file size validation (11+ MB)
6. **Drop mixed content** - Folders, files, and ZIPs together

## 📚 Learn More

- [@shipstatic/dropzone package](../dropzone/README.md)
- [Ship SDK documentation](../../ship/README.md)
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [webkitGetAsEntry (webkit fallback)](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry)

## 💡 Key Takeaways

1. **Headless = Flexibility** - You control every aspect of the UI
2. **Folder Structure Matters** - Custom implementation required for proper folder drag-and-drop
3. **Modern APIs** - File System Access API + webkit fallback covers all browsers
4. **Path Preservation** - Always use `f.path`, never `f.file.name`
5. **Ship SDK Ready** - Files are pre-processed in the exact format Ship SDK expects

---

**Note:** This is a demo application. No files are actually uploaded anywhere. It only demonstrates the file preparation capabilities of `@shipstatic/dropzone`.
