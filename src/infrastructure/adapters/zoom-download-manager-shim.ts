// Zoom Meeting SDK 6.2.0 bundles its download manager in the CommonJS path,
// but its UMD AMD declaration still names this private, unpublished module.
// Turbopack resolves every named AMD dependency even though the browser bundle
// uses the bundled implementation, so this inert alias keeps resolution safe.
const zoomDownloadManager = {};

export default zoomDownloadManager;
