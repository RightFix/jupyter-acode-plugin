import plugin from '../plugin.json';
import { marked } from 'marked';
import tag from 'html-tag-js';
import notebookStyles from './styles.css';

const CELL_TYPES = {
  CODE: 'code',
  MARKDOWN: 'markdown',
  RAW: 'raw'
};

const PAIRS = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`'
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
  editorFile = null;
  notebooks = new Map();
  EditorFile = null;

  init(baseUrl) {
    this.baseUrl = baseUrl;
    this.EditorFile = acode.require('editorFile');
    this.registerCommands();
    this.registerFileHandler();
    this.setupEditorHook();
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
        await this.openNotebookFile(fileInfo.uri, fileInfo.name);
      }
    });
  }

  setupEditorHook() {
    editorManager.on('switch-file', this.onSwitchFile.bind(this));
  }

  onSwitchFile(file) {
    // Check if switching to a notebook tab
    const notebookData = this.notebooks.get(file.id);
    if (notebookData) {
      this.currentFile = notebookData.uri;
      this.currentFileName = file.filename;
      this.notebookData = notebookData.data;
      this.$container = notebookData.container;
      this.$cells = notebookData.cellsContainer;
      this.selectedCellIndex = notebookData.selectedIndex;
      this.isModified = notebookData.modified;
      this.editorFile = file;
      this.showNotebookInEditor();
    } else {
      // Switching to a regular file, hide notebook if visible
      if (this.$container && this.$container.parentElement) {
        this.$container.style.display = 'none';
      }
    }
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
    try {
      const loader = acode.loader('Loading notebook...', 'Please wait');
      loader.show();

      const content = await acode.fsOperation(uri).readFile('utf-8');
      const notebookData = JSON.parse(content);
      
      loader.hide();

      // Check if already open
      const existingFile = editorManager.getFile(uri, 'uri');
      if (existingFile) {
        editorManager.switchFile(existingFile.id);
        return;
      }

      // Create new editor file tab
      const file = new this.EditorFile(filename, {
        uri: uri,
        text: JSON.stringify(notebookData, null, 2),
        render: true,
        isUnsaved: false,
        id: `jupyter-${Date.now()}`
      });

      this.currentFile = uri;
      this.currentFileName = filename;
      this.notebookData = notebookData;
      this.editorFile = file;
      this.selectedCellIndex = -1;
      this.isModified = false;

      // Create notebook container
      this.createNotebookContainer();
      
      // Store notebook data
      this.notebooks.set(file.id, {
        uri: uri,
        data: notebookData,
        container: this.$container,
        cellsContainer: this.$cells,
        selectedIndex: this.selectedCellIndex,
        modified: false
      });

      // Show notebook in editor
      this.showNotebookInEditor();

    } catch (error) {
      acode.alert('Error', `Failed to open notebook: ${error.message}`);
    }
  }

  createNotebookContainer() {
    this.$container = tag('div', {
      className: 'notebook-container',
      style: { background: '#ffffff' }
    });

    const styleEl = tag('style', { textContent: notebookStyles });
    this.$container.appendChild(styleEl);

    const toolbar = tag('div', {
      className: 'notebook-toolbar',
      innerHTML: `
        <button class="toolbar-btn add-code-btn">+ Code</button>
        <button class="toolbar-btn add-md-btn">+ Markdown</button>
        <button class="toolbar-btn run-all-btn">Run All</button>
        <button class="toolbar-btn save-btn">Save</button>
      `
    });
    
    toolbar.querySelector('.add-code-btn').onclick = () => this.addCell(CELL_TYPES.CODE);
    toolbar.querySelector('.add-md-btn').onclick = () => this.addCell(CELL_TYPES.MARKDOWN);
    toolbar.querySelector('.run-all-btn').onclick = () => this.runAllCells();
    toolbar.querySelector('.save-btn').onclick = () => this.saveNotebook();
    
    this.$container.appendChild(toolbar);

    this.$cells = tag('div', { className: 'cells-container' });
    this.renderCells();
    this.$container.appendChild(this.$cells);
  }

  showNotebookInEditor() {
    const $editors = document.getElementById('editors');
    const $header = document.querySelector('header.header') || document.querySelector('.header');
    
    // Position notebook below header
    if ($header) {
      const headerHeight = $header.offsetHeight || 44;
      this.$container.style.top = headerHeight + 'px';
    }

    // Hide the editor content but keep structure
    if ($editors) {
      $editors.style.display = 'none';
    }

    // Show notebook
    if (!this.$container.parentElement) {
      const main = document.querySelector('main') || document.querySelector('.main') || document.body;
      main.appendChild(this.$container);
    }
    this.$container.style.display = 'block';
  }

  hideNotebookFromEditor() {
    if (this.$container) {
      this.$container.style.display = 'none';
    }
    
    const $editors = document.getElementById('editors');
    if ($editors) {
      $editors.style.display = '';
    }
  }

  renderCells() {
    this.$cells.innerHTML = '';

    if (!this.notebookData || !this.notebookData.cells) {
      this.$cells.innerHTML = '<div class="empty-notebook">No cells. Add a cell to start.</div>';
      return;
    }

    this.notebookData.cells.forEach((cell, index) => {
      const $cell = this.createCellElement(cell, index);
      this.$cells.appendChild($cell);
    });
    
    this.saveNotebookState();
  }

  setupIntellisense($editor) {
    $editor.addEventListener('keydown', (e) => {
      const start = $editor.selectionStart;
      const end = $editor.selectionEnd;
      const value = $editor.value;

      if (PAIRS[e.key]) {
        e.preventDefault();
        const closing = PAIRS[e.key];
        const selectedText = value.substring(start, end);
        const newValue = value.substring(0, start) + e.key + selectedText + closing + value.substring(end);
        $editor.value = newValue;
        $editor.selectionStart = $editor.selectionEnd = start + 1;
        $editor.dispatchEvent(new Event('input'));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const currentLine = value.substring(lineStart, start);
        const indent = currentLine.match(/^\s*/)[0];
        let extraIndent = '';
        const trimmedLine = currentLine.trim();
        if (trimmedLine.endsWith(':') && /^(def |class |if |elif |else|for |while |try|except|with )/.test(trimmedLine)) {
          extraIndent = '    ';
        }
        const newValue = value.substring(0, start) + '\n' + indent + extraIndent + value.substring(end);
        $editor.value = newValue;
        $editor.selectionStart = $editor.selectionEnd = start + 1 + indent.length + extraIndent.length;
        $editor.dispatchEvent(new Event('input'));
        return;
      }

      if (e.key === 'Backspace') {
        const before = value.substring(start - 1, start);
        const after = value.substring(start, start + 1);
        if (PAIRS[before] === after) {
          e.preventDefault();
          $editor.value = value.substring(0, start - 1) + value.substring(start + 1);
          $editor.selectionStart = $editor.selectionEnd = start - 1;
          $editor.dispatchEvent(new Event('input'));
        }
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        const newValue = value.substring(0, start) + '    ' + value.substring(end);
        $editor.value = newValue;
        $editor.selectionStart = $editor.selectionEnd = start + 4;
        $editor.dispatchEvent(new Event('input'));
      }
    });
  }

  createCellElement(cell, index) {
    const $cell = tag('div', {
      className: `cell cell-${cell.cell_type}${index === this.selectedCellIndex ? ' selected' : ''}`,
      dataset: { index }
    });

    const $cellActions = tag('div', {
      className: 'cell-actions',
      innerHTML: `
        <button class="btn-run" title="Run (Shift+Enter)">▶</button>
        <button class="btn-up" title="Move Up">↑</button>
        <button class="btn-down" title="Move Down">↓</button>
        <button class="btn-delete" title="Delete">🗑</button>
      `
    });

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
      $editor.oninput = () => {
        this.updateCellSource(cell, $editor.value);
        this.autoResize($editor);
      };
      this.setupIntellisense($editor);
    } else {
      const $promptArea = tag('div', { className: 'prompt-area' });

      const execNum = cell.execution_count || ' ';
      const $prompt = tag('div', {
        className: 'input-prompt',
        innerHTML: `<span class="in-prompt">In [${execNum}]:</span>`
      });

      const $editor = tag('textarea', {
        className: 'cell-editor code-editor',
        value: this.getSourceText(cell.source),
        spellcheck: false
      });

      $promptArea.appendChild($prompt);
      $promptArea.appendChild($editor);
      $cellContent.appendChild($promptArea);

      $editor.onfocus = () => this.selectCell(index);
      $editor.oninput = () => {
        this.updateCellSource(cell, $editor.value);
        this.autoResize($editor);
      };

      $editor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          this.runCell(index);
        }
      });

      this.setupIntellisense($editor);
      setTimeout(() => this.autoResize($editor), 0);
    }

    if (cell.cell_type === CELL_TYPES.CODE && cell.outputs && cell.outputs.length > 0) {
      const $outputs = tag('div', { className: 'cell-outputs' });

      cell.outputs.forEach(output => {
        const $outputContainer = tag('div', { className: 'prompt-area' });

        if (output.output_type === 'execute_result') {
          const $outPrompt = tag('div', {
            className: 'output-prompt',
            innerHTML: `<span class="out-prompt">Out[${cell.execution_count}]:</span>`
          });
          $outputContainer.appendChild($outPrompt);
        }

        const $output = tag('div', {
          className: `output output-${output.output_type}`,
          innerHTML: this.renderOutput(output)
        });
        $outputContainer.appendChild($output);
        $outputs.appendChild($outputContainer);
      });

      $cellContent.appendChild($outputs);
    }

    $cell.appendChild($cellActions);
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

  autoResize($editor) {
    $editor.style.height = 'auto';
    $editor.style.height = $editor.scrollHeight + 'px';
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
    this.autoResize($editor);
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
    this.saveNotebookState();
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

  async runAllCells() {
    const cells = this.notebookData.cells.filter(c => c.cell_type === CELL_TYPES.CODE);
    for (let i = 0; i < cells.length; i++) {
      const index = this.notebookData.cells.indexOf(cells[i]);
      await this.runCell(index);
    }
  }

  async runCell(index = this.selectedCellIndex) {
    if (index < 0) return;

    const cell = this.notebookData.cells[index];
    if (cell.cell_type !== CELL_TYPES.CODE) return;

    const $cell = this.$cells.querySelector(`[data-index="${index}"]`);
    const $editor = $cell.querySelector('.cell-editor');
    const code = $editor.value;

    const $prompt = $cell.querySelector('.input-prompt');
    if ($prompt) {
      $prompt.innerHTML = '<span class="in-prompt">In [*]:</span>';
    }

    const $outputs = $cell.querySelector('.cell-outputs');
    if ($outputs) $outputs.remove();

    const $cellContent = $cell.querySelector('.cell-content');
    const $newOutputs = tag('div', { className: 'cell-outputs' });
    $newOutputs.innerHTML = '<div class="output running">Running...</div>';
    $cellContent.appendChild($newOutputs);

    try {
      const result = await this.executeCode(code);
      cell.outputs = result.outputs || [];
      cell.execution_count = result.execution_count || Date.now();

      if ($prompt) {
        $prompt.innerHTML = `<span class="in-prompt">In [${cell.execution_count}]:</span>`;
      }

      $newOutputs.innerHTML = '';

      if (cell.outputs.length === 0) {
        $newOutputs.remove();
      } else {
        cell.outputs.forEach(output => {
          const $outputContainer = tag('div', { className: 'prompt-area' });

          if (output.output_type === 'execute_result') {
            const $outPrompt = tag('div', {
              className: 'output-prompt',
              innerHTML: `<span class="out-prompt">Out[${cell.execution_count}]:</span>`
            });
            $outputContainer.appendChild($outPrompt);
          }

          const $output = tag('div', {
            className: `output output-${output.output_type}`,
            innerHTML: this.renderOutput(output)
          });
          $outputContainer.appendChild($output);
          $newOutputs.appendChild($outputContainer);
        });
      }

      this.setModified(true);
    } catch (error) {
      $newOutputs.innerHTML = `<div class="output output-error"><pre>${this.escapeHtml(error.message)}</pre></div>`;
    }
    
    this.saveNotebookState();
  }

  async executeCode(code) {
    const pythonCode = code.trim();
    if (!pythonCode) {
      return { outputs: [], execution_count: null };
    }

    try {
      let result;
      try {
        result = await Executor.execute(`python3 -c ${JSON.stringify(pythonCode)} 2>&1`, true);
      } catch (e1) {
        try {
          result = await Executor.execute(`python3 -c ${JSON.stringify(pythonCode)} 2>&1`, false);
        } catch (e2) {
          const escapedCode = pythonCode.replace(/'/g, "'\"'\"'");
          result = await Executor.execute(`echo '${escapedCode}' | python3 2>&1`, true);
        }
      }

      if (result.includes('command not found') || result.includes('not found') || result.includes('No such file')) {
        return {
          outputs: [{
            output_type: 'error',
            ename: 'Error',
            evalue: 'Python not installed. Run: apk add python3',
            traceback: ['Python not installed', 'Install in terminal: apk add python3']
          }],
          execution_count: null
        };
      }

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
          evalue: error.message || 'Failed to execute',
          traceback: [error.message || 'Unknown error']
        }],
        execution_count: null
      };
    }
  }

  createNewNotebook() {
    this.notebookData = {
      cells: [],
      metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        language_info: { name: 'python', version: '3.9.0' }
      },
      nbformat: 4,
      nbformat_minor: 5
    };
  }

  saveNotebookState() {
    if (this.editorFile && this.notebooks.has(this.editorFile.id)) {
      const state = this.notebooks.get(this.editorFile.id);
      state.data = this.notebookData;
      state.selectedIndex = this.selectedCellIndex;
      state.modified = this.isModified;
    }
  }

  setModified(value) {
    this.isModified = value;
    if (this.editorFile) {
      this.editorFile.isUnsaved = value;
    }
    this.saveNotebookState();
  }

  async saveNotebook() {
    if (!this.currentFile) {
      acode.alert('Info', 'Cannot save: no file path');
      return;
    }

    try {
      await acode.fsOperation(this.currentFile).writeFile(JSON.stringify(this.notebookData, null, 2));
      this.setModified(false);
      acode.pushNotification('Saved', 'Notebook saved!', { type: 'success' });
    } catch (error) {
      acode.alert('Error', `Failed to save: ${error.message}`);
    }
  }

  destroy() {
    const { commands } = editorManager.editor;
    commands.removeCommand('open-notebook-viewer');
    acode.unregisterFileHandler(plugin.id);
    
    this.notebooks.forEach((state, fileId) => {
      if (state.container && state.container.parentElement) {
        state.container.remove();
      }
    });
    this.notebooks.clear();
  }
}

if (window.acode) {
  const jupyterPlugin = new JupyterNotebook();

  acode.setPluginInit(plugin.id, (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    jupyterPlugin.init(baseUrl);
  });

  acode.setPluginUnmount(plugin.id, () => {
    jupyterPlugin.destroy();
  });
}
