const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersionInfo: () => ipcRenderer.invoke('app:get-version-info'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  launcher: {
    list: () => ipcRenderer.invoke('launcher:list'),
    addPaths: (paths, categoryId) => ipcRenderer.invoke('launcher:add-paths', { paths, categoryId }),
    updateItem: (item) => ipcRenderer.invoke('launcher:update-item', item),
    removeItem: (id) => ipcRenderer.invoke('launcher:remove-item', id),
    openItem: (id) => ipcRenderer.invoke('launcher:open-item', id),
    revealItem: (id) => ipcRenderer.invoke('launcher:reveal-item', id),
    syncIcon: (id) => ipcRenderer.invoke('launcher:sync-icon', id),
    addCategory: (category) => ipcRenderer.invoke('launcher:add-category', category),
    renameCategory: (id, category) => ipcRenderer.invoke('launcher:rename-category', { id, ...category }),
    removeCategory: (id) => ipcRenderer.invoke('launcher:remove-category', id),
    setCategoryPinned: (id, pinned) => ipcRenderer.invoke('launcher:set-category-pinned', { id, pinned }),
    sortCategories: (orderedCategoryIds) => ipcRenderer.invoke('launcher:sort-categories', orderedCategoryIds),
    sortItems: (payload) => ipcRenderer.invoke('launcher:sort-items', payload),
    pickFiles: () => ipcRenderer.invoke('dialog:pick-files'),
    pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  },
});
