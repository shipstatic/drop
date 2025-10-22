# @shipstatic/drop Demo

A demonstration app showcasing the **headless** architecture of `@shipstatic/drop` with custom UI components.

## 🎯 What This Demo Shows

This demo demonstrates how to build a complete file upload experience using the `@shipstatic/drop` headless hook:

- ✅ **Custom Drop Zone** - Built from scratch with folder structure preservation
- ✅ **Modern Browser APIs** - File System Access API + webkit fallback
- ✅ **Folder Drag & Drop** - Preserves complete folder structure via `webkitRelativePath`
- ✅ **ZIP Extraction** - Automatic extraction and processing
- ✅ **File Validation** - Size, count, and total size limits
- ✅ **Path Normalization** - Sanitization and common prefix stripping
- ✅ **Junk Filtering** - Automatic removal of .DS_Store, Thumbs.db, etc.
- ✅ **Real-time Status** - Processing indicators and validation errors
- ✅ **Granular Error Reporting** - Per-file error messages with demo button

**Important:** This demo does NOT upload files anywhere. It only processes and prepares files for upload.

### 🔍 Interactive Error Reporting Demo

Click the **"Demo: Show Granular Error Reporting"** button to see how the system provides precise per-file error feedback:

**Global Error Summary:**
```
❌ Invalid File Name
4 file(s) failed validation

All errors:
• ../../../etc/passwd: File name contains path traversal pattern
• file?.txt: File name contains unsafe characters
• image.jpg: File extension does not match MIME type
• app.wasm: File type "application/wasm" is not allowed
```

**Per-File Display:**
- ✓ `index.html` - Ready for upload (green background)
- ✗ `../../../etc/passwd` - ⚠️ File name contains path traversal pattern (red background)
- ✓ `style.css` - Ready for upload
- ✗ `file?.txt` - ⚠️ File name contains unsafe characters
- ✗ `image.jpg` - ⚠️ File extension does not match MIME type
- ✓ `app.js` - Ready for upload
- ✗ `app.wasm` - ⚠️ File type "application/wasm" is not allowed

This demonstrates that **users get precise feedback about which files failed and why**, not just a generic error message.

## 🏗️ Architecture

This demo shows the **recommended pattern** for using `@shipstatic/drop`:

```
┌─────────────────────────────────────┐
│  @shipstatic/drop (headless)        │
│  • useDrop hook                     │
│  • File processing logic            │
│  • ZIP extraction                   │
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

1. **Folder structure matters** - Generic drop zone libraries (like `react-dropzone`) don't preserve `webkitRelativePath`
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
- Per-file error messages
- Clear all button
- Status-specific styling

### Integration Pattern

```typescript
// App.tsx - The integration point
import { useDrop } from '@shipstatic/drop';
import { CustomDropzone } from './components/CustomDropzone';
import { FileListDisplay } from './components/FileListDisplay';

function App() {
  // 1. Use the headless hook
  const drop = useDrop({
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
        onFilesSelected={drop.processFiles}
        disabled={drop.isProcessing}
      />

      {/* 3. Display processed files */}
      <FileListDisplay
        files={drop.files}
      />

      {/* 4. Ready for Ship SDK */}
      <button onClick={() => {
        const files = drop.getValidFiles().map(f => f.file);
        // Ship SDK will calculate MD5 during deployment
        // await ship.deployments.create(files);
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
const validFiles = drop.getValidFiles();
const files = validFiles.map(f => f.file);

// Ship SDK will calculate MD5 during deployment
await ship.deployments.create(files);
```

**Note:** Drop provides validated File objects with `webkitRelativePath` preserved. Ship SDK will calculate MD5 checksums during deployment.

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
  const drop = useDrop();

  return (
    <>
      <input
        type="file"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          drop.processFiles(files);
        }}
      />

      <div>
        {drop.files.map(f => (
          <div key={f.id}>{f.name} - {f.status}</div>
        ))}
      </div>

      <button
        onClick={() => {
          const files = drop.getValidFiles().map(f => f.file);
          console.log('Ready to upload:', files);
        }}
        disabled={drop.isProcessing}
      >
        Upload {drop.getValidFiles().length} files
      </button>
    </>
  );
}
```

## 🔧 Configuration

The demo uses these validation limits:

```typescript
const drop = useDrop({
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
7. **Click "🔍 Demo: Show Granular Error Reporting"** - See per-file validation errors (detailed at top of README)

## 📚 Learn More

- [@shipstatic/drop package](../README.md)
- [Ship SDK documentation](../../ship/README.md)
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [webkitGetAsEntry (webkit fallback)](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry)

## 💡 Key Takeaways

1. **Headless = Flexibility** - You control every aspect of the UI
2. **Folder Structure Matters** - Custom implementation required for proper folder drag-and-drop
3. **Modern APIs** - File System Access API + webkit fallback covers all browsers
4. **Path Preservation** - `webkitRelativePath` is preserved on File objects for folder structure
5. **Ship SDK Ready** - Files are validated and prepared for deployment

---

**Note:** This is a demo application. No files are actually uploaded anywhere. It only demonstrates the file preparation capabilities of `@shipstatic/drop`.
