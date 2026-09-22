const fs = require('fs');
let content = fs.readFileSync('electron/preload.ts', 'utf8');
content = content.replace(
  "createWorkOrder: (input: CreateWorkOrderInput) => ipcRenderer.invoke('docket:source:create-work-order', input),",
  \`createWorkOrder: (input: CreateWorkOrderInput) => ipcRenderer.invoke('docket:source:create-work-order', input),
  dismissPendingFinding: (workOrderId: WorkOrderId, id: number) => ipcRenderer.invoke('docket:source:dismiss-pending-finding', workOrderId, id),
  consumePendingFinding: (id: number) => ipcRenderer.invoke('docket:source:consume-pending-finding', id),\`
);
fs.writeFileSync('electron/preload.ts', content);
