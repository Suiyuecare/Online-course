// Zoom Meeting SDK 6.2.0 bundles its download manager in the CommonJS path,
// but the UMD AMD declaration still names this private module. Turbopack
// resolves every named dependency, so this browser-only fallback keeps the
// declaration resolvable without exposing any application data.
const zoomDownloadManager = {};
export default zoomDownloadManager;
