import plugin from '../plugin.json';
import { marked } from 'marked';
import notebookStyles from './styles.css';

const CELL_TYPES = {
  CODE: 'code',
  MARKDOWN: 'markdown',
  RAW: 'raw'
};

class JupyterNotebook {
  baseUrl = '';
  $page = null;
  notebookData = null;
  currentFile = null;
  $container = null;
  $header = null;
  $cells = null;
  selectedCellIndex = -1;
  isModified = false;

  async init($page, cacheFile, cacheFileUrl) {
    this.$page = $page;
    this.cacheFile = cacheFile;
    this.cacheFileUrl = cacheFileUrl;
    
    this.registerCommands();
    this.setupFileHandler();
  }

  registerCommands() {
    const { commands } = editorManager.editor;

    commands.addCommand({
      name: 'open-notebook-viewer',
      description: 'Open Jupyter Notebook viewer',
      exec: () => this.openNotebookViewer()
    });

    commands.addCommand({
      name: 'add-code-cell',
      description: 'Add code cell',
      exec: () => this.addCell(CELL_TYPES.CODE)
    });

    commands.addCommand({
      name: 'add-markdown-cell',
      description: 'Add markdown cell',
      exec: () => this.addCell(CELL_TYPES.MARKDOWN)
    });

    commands.addCommand({
      name: 'delete-cell',
      description: 'Delete current cell',
      exec: () => this.deleteCell()
    });

    commands.addCommand({
      name: 'move-cell-up',
      description: 'Move cell up',
      exec: () => this.moveCell(-1)
    });

    commands.addCommand({
      name: 'move-cell-down',
      description: 'Move cell down',
      exec: () => this.moveCell(1)
    });

    commands.addCommand({
      name: 'save-notebook',
      description: 'Save notebook',
      exec: () => this.saveNotebook()
    });

    commands.addCommand({
      name: 'run-cell',
      description: 'Run current cell',
      exec: () => this.runCell()
    });

    commands.addCommand({
      name: 'toggle-cell-type',
      description: 'Toggle cell type (code/markdown)',
      exec: () => this.toggleCellType()
    });
  }

  setupFileHandler() {
    const originalOpenFile = editorManager.openFile;
    const self = this;
    
    editorManager.openFile = async function(filename, options) {
      if (filename.endsWith('.ipynb')) {
        return self.openNotebookFile(filename, options);
      }
      return originalOpenFile.call(this, filename, options);
    };
  }

  async openNotebookFile(filename, options) {
    try {
      const loader = acode.loader('Loading notebook...', 'Please wait');
      loader.show();

      const fs = acode.require('fs');
      const content = await fs.readFile(filename);
      
      this.notebookData = JSON.parse(content);
      this.currentFile = filename;
      
      loader.hide();
      
      this.renderNotebookViewer();
    } catch (error) {
      acode.alert('Error', `Failed to open notebook: ${error.message}`);
    }
  }

  async openNotebookViewer() {
    const fs = acode.require('fs');
    const files = await fs.pickFile(['.ipynb']);
    
    if (files && files.length > 0) {
      await this.openNotebookFile(files[0], {});
    }
  }

  renderNotebookViewer() {
    if (!this.$page) {
      this.$page = this.createPage();
    }
    
    this.$page.innerHTML = '';
    
    this.$header = this.createHeader();
    this.$container = document.createElement('div');
    this.$container.className = 'notebook-container';
    
    const styleEl = document.createElement('style');
    styleEl.textContent = notebookStyles;
    this.$container.appendChild(styleEl);
    
    this.$cells = document.createElement('div');
    this.$cells.className = 'cells-container';
    
    this.renderCells();
    
    this.$container.appendChild(this.$cells);
    this.$page.appendChild(this.$header);
    this.$page.appendChild(this.$container);
    
    this.$page.show();
  }

  createPage() {
    const page = document.createElement('div');
    page.className = 'page jupyter-notebook-page';
    page.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #1e1e1e;
      z-index: 100;
      display: flex;
      flex-direction: column;
    `;
    document.body.appendChild(page);
    return page;
  }

  createHeader() {
    const header = document.createElement('header');
    header.className = 'notebook-header';
    header.innerHTML = `
      <div class="header-left">
        <button class="btn-back" title="Close">
          <span class="icon icon-arrow-left"></span>
        </button>
        <span class="filename">${this.getFileName()}</span>
        <span class="modified-indicator" style="display: none;">●</span>
      </div>
      <div class="header-right">
        <button class="btn-add-code" title="Add Code Cell">+ Code</button>
        <button class="btn-add-md" title="Add Markdown Cell">+ Markdown</button>
        <button class="btn-save" title="Save">
          <span class="icon icon-save"></span>
        </button>
        <button class="btn-menu" title="Menu">
          <span class="icon icon-more-vert"></span>
        </button>
      </div>
    `;

    header.querySelector('.btn-back').onclick = () => this.closeViewer();
    header.querySelector('.btn-add-code').onclick = () => this.addCell(CELL_TYPES.CODE);
    header.querySelector('.btn-add-md').onclick = () => this.addCell(CELL_TYPES.MARKDOWN);
    header.querySelector('.btn-save').onclick = () => this.saveNotebook();
    header.querySelector('.btn-menu').onclick = () => this.showMenu();

    return header;
  }

  getFileName() {
    if (!this.currentFile) return 'Untitled.ipynb';
    const parts = this.currentFile.split('/');
    return parts[parts.length - 1];
  }

  renderCells() {
    this.$cells.innerHTML = '';
    
    if (!this.notebookData || !this.notebookData.cells) {
      this.$cells.innerHTML = '<div class="empty-notebook">No cells in this notebook. Add a cell to get started.</div>';
      return;
    }

    this.notebookData.cells.forEach((cell, index) => {
      const $cell = this.createCellElement(cell, index);
      this.$cells.appendChild($cell);
    });
  }

  createCellElement(cell, index) {
    const $cell = document.createElement('div');
    $cell.className = `cell cell-${cell.cell_type}${index === this.selectedCellIndex ? ' selected' : ''}`;
    $cell.dataset.index = index;
    
    const $cellHeader = document.createElement('div');
    $cellHeader.className = 'cell-header';
    
    const $cellType = document.createElement('span');
    $cellType.className = 'cell-type';
    $cellType.textContent = cell.cell_type.toUpperCase();
    
    const $cellActions = document.createElement('div');
    $cellActions.className = 'cell-actions';
    $cellActions.innerHTML = `
      <button class="btn-run" title="Run">▶</button>
      <button class="btn-up" title="Move Up">↑</button>
      <button class="btn-down" title="Move Down">↓</button>
      <button class="btn-delete" title="Delete">🗑</button>
    `;

    $cellHeader.appendChild($cellType);
    $cellHeader.appendChild($cellActions);
    
    const $cellContent = document.createElement('div');
    $cellContent.className = 'cell-content';
    
    if (cell.cell_type === CELL_TYPES.MARKDOWN) {
      const $preview = document.createElement('div');
      $preview.className = 'markdown-preview';
      $preview.innerHTML = marked.parse(this.getSourceText(cell.source));
      
      const $editor = document.createElement('textarea');
      $editor.className = 'cell-editor';
      $editor.value = this.getSourceText(cell.source);
      $editor.style.display = 'none';
      $editor.spellcheck = false;
      
      $cellContent.appendChild($preview);
      $cellContent.appendChild($editor);
      
      $preview.onclick = () => this.editMarkdownCell($cell, $preview, $editor);
      $editor.onblur = () => this.finishEditMarkdownCell(cell, $preview, $editor);
    } else {
      const $editor = document.createElement('textarea');
      $editor.className = 'cell-editor code-editor';
      $editor.value = this.getSourceText(cell.source);
      $editor.spellcheck = false;
      $editor.placeholder = cell.cell_type === CELL_TYPES.CODE ? 'Enter code...' : 'Enter raw text...';
      
      $cellContent.appendChild($editor);
      
      $editor.onfocus = () => this.selectCell(index);
      $editor.oninput = () => this.updateCellSource(cell, $editor.value);
    }

    if (cell.cell_type === CELL_TYPES.CODE && cell.outputs && cell.outputs.length > 0) {
      const $outputs = document.createElement('div');
      $outputs.className = 'cell-outputs';
      
      cell.outputs.forEach(output => {
        const $output = document.createElement('div');
        $output.className = `output output-${output.output_type}`;
        $output.innerHTML = this.renderOutput(output);
        $outputs.appendChild($output);
      });
      
      $cellContent.appendChild($outputs);
    }

    $cell.appendChild($cellHeader);
    $cell.appendChild($cellContent);

    $cellActions.querySelector('.btn-run').onclick = (e) => {
      e.stopPropagation();
      this.runCell(index);
    };
    $cellActions.querySelector('.btn-up').onclick = (e) => {
      e.stopPropagation();
      this.moveCell(index, -1);
    };
    $cellActions.querySelector('.btn-down').onclick = (e) => {
      e.stopPropagation();
      this.moveCell(index, 1);
    };
    $cellActions.querySelector('.btn-delete').onclick = (e) => {
      e.stopPropagation();
      this.deleteCell(index);
    };

    $cell.onclick = () => this.selectCell(index);

    return $cell;
  }

  getSourceText(source) {
    if (typeof source === 'string') return source;
    if (Array.isArray(source)) return source.join('');
    return '';
  }

  updateCellSource(cell, text) {
    cell.source = text.split('\n').map((line, i, arr) => 
      i < arr.length - 1 ? line + '\n' : line
    );
    this.setModified(true);
  }

  editMarkdownCell($cell, $preview, $editor) {
    $preview.style.display = 'none';
    $editor.style.display = 'block';
    $editor.focus();
    this.selectCell(parseInt($cell.dataset.index));
  }

  finishEditMarkdownCell(cell, $preview, $editor) {
    $editor.style.display = 'none';
    $preview.style.display = 'block';
    $preview.innerHTML = marked.parse($editor.value);
    this.updateCellSource(cell, $editor.value);
  }

  renderOutput(output) {
    if (output.output_type === 'stream') {
      return `<pre class="output-stream">${this.escapeHtml(output.text || '')}</pre>`;
    }
    if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
      if (output.data && output.data['text/html']) {
        return output.data['text/html'];
      }
      if (output.data && output.data['image/png']) {
        return `<img src="data:image/png;base64,${output.data['image/png']}" />`;
      }
      if (output.data && output.data['text/plain']) {
        return `<pre class="output-result">${this.escapeHtml(output.data['text/plain'])}</pre>`;
      }
    }
    if (output.output_type === 'error') {
      return `<pre class="output-error">${this.escapeHtml(output.traceback ? output.traceback.join('\n') : output.evalue)}</pre>`;
    }
    return '';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  selectCell(index) {
    this.selectedCellIndex = index;
    const cells = this.$cells.querySelectorAll('.cell');
    cells.forEach((cell, i) => {
      cell.classList.toggle('selected', i === index);
    });
  }

  addCell(type) {
    if (!this.notebookData) {
      this.createNewNotebook();
    }

    const newCell = {
      cell_type: type,
      source: [],
      metadata: {},
      execution_count: type === CELL_TYPES.CODE ? null : undefined,
      outputs: type === CELL_TYPES.CODE ? [] : undefined
    };

    const insertIndex = this.selectedCellIndex >= 0 ? this.selectedCellIndex + 1 : this.notebookData.cells.length;
    this.notebookData.cells.splice(insertIndex, 0, newCell);
    
    this.renderCells();
    this.selectCell(insertIndex);
    this.setModified(true);

    setTimeout(() => {
      const $newCell = this.$cells.querySelector(`[data-index="${insertIndex}"] .cell-editor`);
      if ($newCell) $newCell.focus();
    }, 100);
  }

  deleteCell(index = this.selectedCellIndex) {
    if (index < 0 || !this.notebookData || this.notebookData.cells.length <= 1) {
      acode.alert('Cannot Delete', 'Notebook must have at least one cell.');
      return;
    }

    this.notebookData.cells.splice(index, 1);
    this.renderCells();
    this.selectCell(Math.min(index, this.notebookData.cells.length - 1));
    this.setModified(true);
  }

  moveCell(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this.notebookData.cells.length) return;

    const cells = this.notebookData.cells;
    [cells[index], cells[newIndex]] = [cells[newIndex], cells[index]];
    
    this.renderCells();
    this.selectCell(newIndex);
    this.setModified(true);
  }

  toggleCellType(index = this.selectedCellIndex) {
    if (index < 0) return;

    const cell = this.notebookData.cells[index];
    if (cell.cell_type === CELL_TYPES.CODE) {
      cell.cell_type = CELL_TYPES.MARKDOWN;
      delete cell.outputs;
      delete cell.execution_count;
    } else if (cell.cell_type === CELL_TYPES.MARKDOWN) {
      cell.cell_type = CELL_TYPES.CODE;
      cell.outputs = [];
      cell.execution_count = null;
    }
    
    this.renderCells();
    this.selectCell(index);
    this.setModified(true);
  }

  async runCell(index = this.selectedCellIndex) {
    if (index < 0) return;

    const cell = this.notebookData.cells[index];
    if (cell.cell_type !== CELL_TYPES.CODE) return;

    const $cell = this.$cells.querySelector(`[data-index="${index}"]`);
    const $editor = $cell.querySelector('.cell-editor');
    const code = $editor.value;

    const $outputs = $cell.querySelector('.cell-outputs');
    if ($outputs) $outputs.remove();

    const $newOutputs = document.createElement('div');
    $newOutputs.className = 'cell-outputs';
    $newOutputs.innerHTML = '<div class="output running">Running...</div>';
    $cell.querySelector('.cell-content').appendChild($newOutputs);

    try {
      const result = await this.executeCode(code);
      cell.outputs = result.outputs || [];
      cell.execution_count = result.execution_count;
      
      $newOutputs.innerHTML = '';
      cell.outputs.forEach(output => {
        const $output = document.createElement('div');
        $output.className = `output output-${output.output_type}`;
        $output.innerHTML = this.renderOutput(output);
        $newOutputs.appendChild($output);
      });
    } catch (error) {
      $newOutputs.innerHTML = `<div class="output output-error"><pre>${this.escapeHtml(error.message)}</pre></div>`;
    }
  }

  async executeCode(code) {
    const pythonCode = code.trim();
    if (!pythonCode) {
      return { outputs: [], execution_count: null };
    }

    try {
      const tempFile = `/tmp/jupyter_cell_${Date.now()}.py`;
      const fs = acode.require('fs');
      await fs.writeFile(tempFile, pythonCode);
      
      const result = await Executor.execute(`python3 ${tempFile} 2>&1`);
      await fs.deleteFile(tempFile);
      
      return {
        outputs: [{
          output_type: 'stream',
          name: 'stdout',
          text: result
        }],
        execution_count: Date.now()
      };
    } catch (error) {
      return {
        outputs: [{
          output_type: 'error',
          ename: 'Error',
          evalue: error.message,
          traceback: [error.message]
        }],
        execution_count: null
      };
    }
  }

  createNewNotebook() {
    this.notebookData = {
      cells: [],
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3'
        },
        language_info: {
          name: 'python',
          version: '3.9.0'
        }
      },
      nbformat: 4,
      nbformat_minor: 5
    };
  }

  setModified(value) {
    this.isModified = value;
    const indicator = this.$header?.querySelector('.modified-indicator');
    if (indicator) {
      indicator.style.display = value ? 'inline' : 'none';
    }
  }

  async saveNotebook() {
    if (!this.currentFile) {
      const fs = acode.require('fs');
      const result = await fs.saveFile('notebook.ipynb', JSON.stringify(this.notebookData, null, 2));
      if (result) {
        this.currentFile = result;
        const filenameEl = this.$header.querySelector('.filename');
        if (filenameEl) filenameEl.textContent = this.getFileName();
      }
    } else {
      const fs = acode.require('fs');
      await fs.writeFile(this.currentFile, JSON.stringify(this.notebookData, null, 2));
    }
    
    this.setModified(false);
    acode.alert('Saved', 'Notebook saved successfully!');
  }

  async closeViewer() {
    if (this.isModified) {
      const save = await acode.confirm('Save changes?', 'Do you want to save your changes before closing?');
      if (save) {
        await this.saveNotebook();
      }
    }
    
    if (this.$page) {
      this.$page.hide();
      this.$page.remove();
      this.$page = null;
    }
    
    this.notebookData = null;
    this.currentFile = null;
    this.selectedCellIndex = -1;
    this.isModified = false;
  }

  showMenu() {
    const options = [
      'Save notebook',
      'Add code cell',
      'Add markdown cell',
      'Toggle cell type',
      'Delete cell',
      'Move cell up',
      'Move cell down',
      'Close notebook'
    ];

    acode.prompt('Notebook Menu', '', 'select', options).then(action => {
      switch (action) {
        case 'Save notebook': this.saveNotebook(); break;
        case 'Add code cell': this.addCell(CELL_TYPES.CODE); break;
        case 'Add markdown cell': this.addCell(CELL_TYPES.MARKDOWN); break;
        case 'Toggle cell type': this.toggleCellType(); break;
        case 'Delete cell': this.deleteCell(); break;
        case 'Move cell up': this.moveCell(this.selectedCellIndex, -1); break;
        case 'Move cell down': this.moveCell(this.selectedCellIndex, 1); break;
        case 'Close notebook': this.closeViewer(); break;
      }
    });
  }

  destroy() {
    const { commands } = editorManager.editor;
    commands.removeCommand('open-notebook-viewer');
    commands.removeCommand('add-code-cell');
    commands.removeCommand('add-markdown-cell');
    commands.removeCommand('delete-cell');
    commands.removeCommand('move-cell-up');
    commands.removeCommand('move-cell-down');
    commands.removeCommand('save-notebook');
    commands.removeCommand('run-cell');
    commands.removeCommand('toggle-cell-type');
    
    if (this.$page) {
      this.$page.remove();
    }
  }
}

if (window.acode) {
  const jupyterPlugin = new JupyterNotebook();
  
  acode.setPluginInit(plugin.id, async (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    jupyterPlugin.baseUrl = baseUrl;
    await jupyterPlugin.init($page, cacheFile, cacheFileUrl);
  });
  
  acode.setPluginUnmount(plugin.id, () => {
    jupyterPlugin.destroy();
  });
}
