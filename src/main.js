import plugin from '../plugin.json';
import { marked } from 'marked';
import tag from 'html-tag-js';
import notebookStyles from './styles.css';

const CELL_TYPES = {
  CODE: 'code',
  MARKDOWN: 'markdown',
  RAW: 'raw'
};

class JupyterNotebook {
  baseUrl = '';
  notebookData = null;
  currentFile = null;
  currentFileName = null;
  $container = null;
  $cells = null;
  selectedCellIndex = -1;
  isModified = false;
  notebookPage = null;

  init(baseUrl) {
    this.baseUrl = baseUrl;
    this.registerCommands();
    this.registerFileHandler();
  }

  registerCommands() {
    const { commands } = editorManager.editor;

    commands.addCommand({
      name: 'open-notebook-viewer',
      description: 'Open Jupyter Notebook viewer',
      exec: () => this.openNotebookPicker()
    });
  }

  registerFileHandler() {
    acode.registerFileHandler(plugin.id, {
      extensions: ['ipynb'],
      handleFile: async (fileInfo) => {
        console.log('Jupyter: File handler called', fileInfo);
        await this.openNotebookFile(fileInfo.uri, fileInfo.name);
      }
    });
  }

  async openNotebookPicker() {
    try {
      const result = await acode.fileBrowser('file', 'Select notebook');
      if (result && result.url) {
        await this.openNotebookFile(result.url, result.filename || 'notebook.ipynb');
      }
    } catch (error) {
      acode.alert('Error', `Failed to open file browser: ${error.message}`);
    }
  }

  async openNotebookFile(uri, filename) {
    console.log('Jupyter: Opening file', uri, filename);
    
    try {
      const loader = acode.loader('Loading notebook...', 'Please wait');
      loader.show();

      const content = await acode.fsOperation(uri).readFile('utf-8');
      console.log('Jupyter: File content loaded', content.substring(0, 200));
      
      this.notebookData = JSON.parse(content);
      this.currentFile = uri;
      this.currentFileName = filename || 'notebook.ipynb';
      
      loader.hide();
      
      this.renderNotebookViewer();
    } catch (error) {
      console.error('Jupyter: Error', error);
      acode.alert('Error', `Failed to open notebook: ${error.message}`);
    }
  }

  renderNotebookViewer() {
    console.log('Jupyter: Rendering viewer');
    
    const actionStack = acode.require('actionStack');

    const backBtn = tag('span', {
      className: 'icon arrowleft',
      onclick: () => this.closeViewer()
    });

    const saveBtn = tag('span', {
      className: 'icon save',
      onclick: () => this.saveNotebook()
    });

    const menuBtn = tag('span', {
      className: 'icon more_vert',
      onclick: () => this.showMenu()
    });

    this.notebookPage = page(this.currentFileName, {
      lead: backBtn,
      tail: [saveBtn, menuBtn]
    });

    this.$container = tag('div', {
      className: 'notebook-container'
    });
    
    const styleEl = tag('style', {
      textContent: notebookStyles
    });
    this.$container.appendChild(styleEl);

    const toolbar = tag('div', {
      className: 'notebook-toolbar',
      innerHTML: `
        <button class="toolbar-btn add-code-btn">+ Code</button>
        <button class="toolbar-btn add-md-btn">+ Markdown</button>
      `
    });
    toolbar.querySelector('.add-code-btn').onclick = () => this.addCell(CELL_TYPES.CODE);
    toolbar.querySelector('.add-md-btn').onclick = () => this.addCell(CELL_TYPES.MARKDOWN);
    this.$container.appendChild(toolbar);
    
    this.$cells = tag('div', {
      className: 'cells-container'
    });
    
    this.renderCells();
    
    this.$container.appendChild(this.$cells);
    this.notebookPage.appendBody(this.$container);

    this.notebookPage.show = () => {
      actionStack.push({
        id: 'jupyter-notebook-viewer',
        action: () => this.closeViewer()
      });
      app.append(this.notebookPage);
    };

    this.notebookPage.show();
    console.log('Jupyter: Viewer shown');
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
    const $cell = tag('div', {
      className: `cell cell-${cell.cell_type}${index === this.selectedCellIndex ? ' selected' : ''}`,
      dataset: { index }
    });
    
    const $cellHeader = tag('div', { className: 'cell-header' });
    
    const $cellType = tag('span', {
      className: 'cell-type',
      textContent: cell.cell_type.toUpperCase()
    });
    
    const $cellActions = tag('div', {
      className: 'cell-actions',
      innerHTML: `
        <button class="btn-run" title="Run">▶</button>
        <button class="btn-up" title="Move Up">↑</button>
        <button class="btn-down" title="Move Down">↓</button>
        <button class="btn-delete" title="Delete">🗑</button>
      `
    });

    $cellHeader.appendChild($cellType);
    $cellHeader.appendChild($cellActions);
    
    const $cellContent = tag('div', { className: 'cell-content' });
    
    if (cell.cell_type === CELL_TYPES.MARKDOWN) {
      const $preview = tag('div', { className: 'markdown-preview' });
      try {
        $preview.innerHTML = marked.parse(this.getSourceText(cell.source));
      } catch (e) {
        $preview.textContent = this.getSourceText(cell.source);
      }
      
      const $editor = tag('textarea', {
        className: 'cell-editor',
        value: this.getSourceText(cell.source),
        style: { display: 'none' },
        spellcheck: false
      });
      
      $cellContent.appendChild($preview);
      $cellContent.appendChild($editor);
      
      $preview.onclick = () => this.editMarkdownCell($cell, $preview, $editor);
      $editor.onblur = () => this.finishEditMarkdownCell(cell, $preview, $editor);
    } else {
      const $editor = tag('textarea', {
        className: 'cell-editor code-editor',
        value: this.getSourceText(cell.source),
        spellcheck: false,
        placeholder: cell.cell_type === CELL_TYPES.CODE ? 'Enter code...' : 'Enter raw text...'
      });
      
      $cellContent.appendChild($editor);
      
      $editor.onfocus = () => this.selectCell(index);
      $editor.oninput = () => this.updateCellSource(cell, $editor.value);
    }

    if (cell.cell_type === CELL_TYPES.CODE && cell.outputs && cell.outputs.length > 0) {
      const $outputs = tag('div', { className: 'cell-outputs' });
      
      cell.outputs.forEach(output => {
        const $output = tag('div', {
          className: `output output-${output.output_type}`,
          innerHTML: this.renderOutput(output)
        });
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
    try {
      $preview.innerHTML = marked.parse($editor.value);
    } catch (e) {
      $preview.textContent = $editor.value;
    }
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
    if (Array.isArray(text)) text = text.join('');
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

    const $newOutputs = tag('div', { className: 'cell-outputs' });
    $newOutputs.innerHTML = '<div class="output running">Running...</div>';
    $cell.querySelector('.cell-content').appendChild($newOutputs);

    try {
      const result = await this.executeCode(code);
      cell.outputs = result.outputs || [];
      cell.execution_count = result.execution_count;
      
      $newOutputs.innerHTML = '';
      cell.outputs.forEach(output => {
        const $output = tag('div', {
          className: `output output-${output.output_type}`,
          innerHTML: this.renderOutput(output)
        });
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
      await acode.fsOperation('/tmp').createFile(`jupyter_cell_${Date.now()}.py`, pythonCode);
      
      const result = await Executor.execute(`python3 ${tempFile} 2>&1`);
      
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
    if (this.notebookPage && this.notebookPage.header) {
      const title = this.notebookPage.header.querySelector('.title');
      if (title) {
        title.textContent = value ? `● ${this.currentFileName}` : this.currentFileName;
      }
    }
  }

  async saveNotebook() {
    if (!this.currentFile) {
      acode.alert('Info', 'Cannot save: no file path available');
      return;
    }
    
    try {
      await acode.fsOperation(this.currentFile).writeFile(JSON.stringify(this.notebookData, null, 2));
      
      this.setModified(false);
      acode.pushNotification('Saved', 'Notebook saved successfully!', { type: 'success' });
    } catch (error) {
      acode.alert('Error', `Failed to save: ${error.message}`);
    }
  }

  async closeViewer() {
    if (this.isModified) {
      const save = await acode.confirm('Save changes?', 'Do you want to save your changes before closing?');
      if (save) {
        await this.saveNotebook();
      }
    }
    
    if (this.notebookPage) {
      this.notebookPage.hide();
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
    
    acode.unregisterFileHandler(plugin.id);
    
    if (this.notebookPage) {
      this.notebookPage.hide();
    }
  }
}

if (window.acode) {
  const jupyterPlugin = new JupyterNotebook();
  
  acode.setPluginInit(plugin.id, (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    jupyterPlugin.init(baseUrl);
  });
  
  acode.setPluginUnmount(plugin.id, () => {
    jupyterPlugin.destroy();
  });
}
