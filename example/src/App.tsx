import { useDrop } from "@shipstatic/drop";
import Ship from "@shipstatic/ship";
import { useState } from "react";

const ship = new Ship({
  // deployToken: 'token-here'
});

function App() {
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [deployError, setDeployError] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);

  const drop = useDrop({ ship });

  const handleDeploy = async () => {
    setDeployError("");
    setDeploymentUrl("");
    setIsDeploying(true);

    try {
      const validFiles = drop.getValidFiles();
      const files = validFiles.map((f) => f.file);
      const result = await ship.deployments.create(files);
      setDeploymentUrl(result.url);
    } catch (err: any) {
      setDeployError(err.message || "Deployment failed");
    } finally {
      setIsDeploying(false);
    }
  };

  const handleClear = () => {
    drop.clearAll();
    setDeploymentUrl("");
    setDeployError("");
    setIsDeploying(false);
  };

  // Computed state for cleaner logic
  const canDeploy = drop.phase === "ready" && !isDeploying && !deploymentUrl;
  const showActions = drop.files.length > 0;

  return (
    <div
      style={{
        padding: "2rem",
        maxWidth: "600px",
        margin: "0 auto",
        fontFamily: "system-ui",
      }}
    >
      <h1>Drop + Ship</h1>
      <p style={{ color: "#666", marginTop: "-0.5rem", marginBottom: "1.5rem" }}>
        Drag & drop files or folders to deploy
      </p>

      {/* Dropzone */}
      <div
        {...drop.getDropzoneProps()}
        style={{
          border: `2px dashed ${drop.isDragging ? "#0066cc" : "#ccc"}`,
          padding: "3rem",
          textAlign: "center",
          cursor: "pointer",
          marginBottom: "1.5rem",
          borderRadius: "8px",
          backgroundColor: drop.isDragging ? "#f0f9ff" : "white",
          transition: "all 0.2s ease",
        }}
      >
        <input {...drop.getInputProps()} />
        <div style={{ pointerEvents: "none", fontSize: "1.1rem" }}>
          {drop.isDragging ? "📂 Drop here" : "📁 Click or drop files/folders"}
        </div>
      </div>

      {/* State-based status display */}
      {drop.phase === "processing" && drop.status && (
        <div
          style={{
            backgroundColor: "#f0f9ff",
            border: "1px solid #bfdbfe",
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "6px",
          }}
        >
          <div style={{ color: "#1e40af", fontWeight: 500 }}>
            {drop.status.title}
          </div>
          <div style={{ color: "#3b82f6", fontSize: "0.9rem", marginTop: "0.25rem" }}>
            {drop.status.details}
          </div>
        </div>
      )}

      {drop.phase === "ready" && drop.sourceName && (
        <div
          style={{
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "6px",
          }}
        >
          <div style={{ color: "#166534", fontWeight: 600, marginBottom: "0.25rem" }}>
            {drop.sourceName}
          </div>
          <div style={{ color: "#16a34a", fontSize: "0.9rem" }}>
            {drop.getValidFiles().length} {drop.getValidFiles().length === 1 ? "file" : "files"} ready to deploy
          </div>
        </div>
      )}

      {drop.phase === "error" && drop.status && (
        <div
          style={{
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            padding: "1rem",
            marginBottom: "1rem",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontWeight: 600, color: "#991b1b", marginBottom: "0.25rem" }}>
            {drop.status.title}
          </div>
          <div style={{ color: "#dc2626", fontSize: "0.9rem" }}>
            {drop.status.details}
          </div>
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button
            onClick={handleDeploy}
            disabled={!canDeploy}
            style={{
              flex: 1,
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              cursor: canDeploy ? "pointer" : "not-allowed",
              border: "none",
              borderRadius: "6px",
              backgroundColor: canDeploy ? "#0066cc" : "#d1d5db",
              color: "white",
              fontWeight: 500,
              transition: "background-color 0.2s ease",
            }}
          >
            {drop.isProcessing
              ? "Processing..."
              : isDeploying
                ? "Deploying..."
                : deploymentUrl
                  ? "Deployed ✓"
                  : "Deploy"}
          </button>
          <button
            onClick={handleClear}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              cursor: "pointer",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              backgroundColor: "white",
              color: "#374151",
              fontWeight: 500,
              transition: "all 0.2s ease",
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Deployment success */}
      {deploymentUrl && (
        <div
          style={{
            backgroundColor: "#f0fdf4",
            border: "1px solid #86efac",
            padding: "1rem",
            borderRadius: "6px",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: "#166534",
              marginBottom: "0.5rem",
            }}
          >
            🎉 Deployed successfully!
          </div>
          <a
            href={deploymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#0066cc",
              wordBreak: "break-all",
              textDecoration: "underline",
            }}
          >
            {deploymentUrl}
          </a>
        </div>
      )}

      {/* Deployment error */}
      {deployError && (
        <div
          style={{
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            padding: "1rem",
            borderRadius: "6px",
            color: "#991b1b",
          }}
        >
          <strong>Deployment failed:</strong> {deployError}
        </div>
      )}

      {/* File list (optional - only shown in ready/error state) */}
      {drop.files.length > 0 && (drop.phase === "ready" || drop.phase === "error") && (
        <details style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
          <summary style={{ cursor: "pointer", color: "#6b7280", userSelect: "none" }}>
            View {drop.files.length} file{drop.files.length === 1 ? "" : "s"}
          </summary>
          <div style={{ marginTop: "0.5rem", maxHeight: "200px", overflowY: "auto" }}>
            {drop.files.map((file) => (
              <div
                key={file.id}
                style={{
                  padding: "0.5rem",
                  borderBottom: "1px solid #f3f4f6",
                  color: file.status === "ready" ? "#374151" : "#ef4444",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                }}
              >
                {file.status === "ready" ? "✓" : "✗"} {file.path}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export default App;
