'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require uci';

function method(name, params, timeout) {
  return rpc.declare({
    object: 'luci.sing-box',
    method: name,
    params: params || [],
    expect: { '': {} },
    timeout: timeout || 30000,
  });
}

const api = {
  status: method('status'),
  read: method('read'),
  logs: method('logs'),
  cache: method('cache'),
  save: method('save', ['content', 'revision']),
  check: method('check', ['content']),
  action: method('action', ['name', 'revision']),
  autostart: method('autostart', ['enabled']),
  updateCore: method('update_core', ['url'], 60000),
};

const messages = {
  apply_failed: 'Configuration saved, but the service failed to start. Check the logs and fix the configuration',
  operation_interrupted: 'Operation interrupted. Check the configuration and service status',
  config_path_invalid: 'sing-box.main.conffile must be an absolute path',
  workdir_invalid: 'sing-box.main.workdir must be an absolute path',
  config_not_regular: 'The configuration path is not a regular file',
  config_symlink: 'Symbolic-link configuration files are not supported',
  service_missing: 'The sing-box executable or init script is missing',
  config_missing: 'No saved configuration',
  config_too_large: 'Configuration exceeds 64 KiB',
  check_failed: 'Configuration check failed (exit code %s)',
  check_prepare_failed: 'Unable to prepare the temporary check file',
  operation_running: 'Running: %s',
  check_passed: 'The configuration passed the sing-box check',
  config_applied: 'Configuration applied. The service is running.',
  start_failed: 'The service failed to start. Check the logs',
  service_running: 'The service is running',
  stop_failed: 'The service failed to stop',
  service_stopped: 'The service has stopped',
  action_unknown: 'Unknown action',
  directories_failed: 'Unable to initialize the panel directories',
  logs_failed: 'Unable to read the system log (logread failed or timed out)',
  request_invalid: 'Invalid request',
  content_invalid: 'Configuration content must be a string',
  operation_busy: 'Another operation is in progress',
  config_save_failed: 'Unable to save the configuration file',
  config_saved: 'Configuration file saved; the service was not restarted',
  config_changed: 'The configuration file has changed. Reload it before saving or applying',
  operation_queued: 'Operation queued',
  enabled_invalid: 'enabled must be a boolean',
  autostart_updated: 'Autostart setting updated',
  autostart_failed: 'Unable to change the autostart setting',
  method_unknown: 'Unknown method',
  core_updated: 'Core updated successfully and the service was restarted',
  download_failed: 'Core download failed. Check the download URL and network connectivity',
  url_invalid: 'Invalid download URL. Enter a valid URL',
  service_status_failed: 'Unable to determine the service process status; operation aborted',
  cache_disabled: 'The saved configuration does not enable a cache file; nothing to clear',
  cache_missing: 'The cache file does not exist; nothing to clear',
  cache_config_invalid: 'Unable to read a valid configuration, so the cache file cannot be determined',
  cache_workdir_unsafe: 'Only dedicated working directories without symbolic links are supported: /etc/sing-box, /usr/share/sing-box, /var/lib/sing-box, /tmp/sing-box',
  cache_path_unsafe: 'Unsafe cache path: it must be a regular file inside the working directory, and cannot be the configuration file, a link or a mount path',
  cache_inspect_failed: 'Unable to read the cache file or mount information. Check system tools and file access permissions',
  cache_changed: 'The configuration or cache file has changed. Reopen the confirmation dialog',
  cache_remove_failed: 'Failed to clear the cache; the service remains stopped',
  cache_start_failed: 'Cache cleared, but the service failed to start. Check the logs; the old cache was not backed up',
  cache_reset: 'Cache cleared; the service remains stopped',
  cache_reset_start: 'Cache cleared and the service restarted',
};

const actions = {
  validate: 'Validate',
  apply: 'Apply',
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  cache_reset: 'Clear cache',
  cache_reset_start: 'Clear cache and start',
};

// Notification colors follow the button that triggered them
const toneColors = {
  apply: '#16a34a',
  warning: '#d97706',
  negative: '#dc2626',
  action: '#2563eb',
  neutral: '#6b7280',
  reset: '#6b7280',
};

function message(result) {
  const value = result.code === 'operation_running' ? actions[result.argument] : result.argument;
  return Object.prototype.hasOwnProperty.call(messages, result.code)
    ? messages[result.code].replace('%s', () => (value == null ? '' : String(value)))
    : result.message || 'Invalid response from the backend';
}

function checked(result) {
  if (!result || !result.ok) throw new Error(result ? (result.details || message(result)) : 'Invalid response from the backend');
  return result;
}

function formatUptime(seconds) {
  const total = Math.floor(Number(seconds));
  if (!isFinite(total) || total < 0) return 'Not running';
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (d) parts.push(d + 'd');
  if (d || h) parts.push(h + 'h');
  if (d || h || m) parts.push(m + 'm');
  parts.push(s + 's');
  return parts.join(' ');
}

function field(title, node) {
  return E('div', { class: 'cbi-value' }, [
    E('div', { class: 'cbi-value-title' }, title),
    E('div', { class: 'cbi-value-field' }, node),
  ]);
}

return view.extend({
  handleSaveApply: null,
  handleSave: null,
  handleReset: null,

  load() {
    return Promise.all([
      api.status().then(checked),
      api.read(),
      uci.load('sing-box'),
    ]);
  },

  notify(text, error, details, tone) {
    if (this.notification) this.notification.remove();
    const content = E('div', {}, [E('p', {}, text)]);
    if (details) content.appendChild(E('pre', { class: 'sing-box-output' }, details));
    const node = error
      ? ui.addNotification(null, content, 'error')
      : ui.addTimeLimitedNotification(null, content, 5000, 'info');
    const color = toneColors[tone || this.tone] || (error ? toneColors.negative : toneColors.action);
    if (node && node.style) {
      node.style.setProperty('border-left', '4px solid ' + color, 'important');
      node.style.setProperty('background-color', color + '22', 'important');
    }
    this.notification = node;
  },

  updateControls() {
    const busy = !!(this.localBusy || this.status.busy);
    this.buttons.forEach(({ node, write, config }) => {
      node.disabled = busy || (write && !this.writable) || (config && !this.loaded);
    });
    this.boot.disabled = busy || !this.writable;
    this.editor.readOnly = busy || !this.writable || !this.loaded;
  },

  async run(fn, write, tone) {
    if (this.localBusy || this.status.busy || (write && !this.writable)) return;
    this.tone = tone;
    this.localBusy = true;
    this.updateControls();
    let result;
    try {
      result = await fn();
    } catch (error) {
      this.notify(error.message, true);
    } finally {
      this.localBusy = false;
      try {
        await this.refresh();
      } catch (error) {
        this.notify(error.message, true);
      }
      this.updateControls();
    }
    return result;
  },

  button(label, fn, style, write = true, config = false) {
    const node = E(
      'button',
      {
        type: 'button',
        class: 'cbi-button cbi-button-' + (style || 'action'),
        click: () => this.run(fn, write, style || 'action'),
      },
      label,
    );
    this.buttons.push({ node, write, config });
    return node;
  },

  updateDirty() {
    let text, color;
    if (!this.loaded) {
      text = 'Failed to read the configuration. Fix the problem and reload.';
      color = toneColors.negative;
    } else if (this.status.revision && this.status.revision !== this.revision) {
      text = messages.config_changed;
      color = toneColors.warning;
    } else if (this.editor.value !== this.savedText) {
      text = 'Unsaved changes. Validate the configuration, then save and apply.';
      color = toneColors.warning;
    } else {
      text = 'Editor content matches the configuration file.';
      color = toneColors.apply;
    }
    this.dirty.textContent = text;
    this.dirty.style.setProperty('color', color, 'important');
    this.dirty.style.setProperty('font-weight', '700', 'important');
  },

  setConfig(result) {
    checked(result);
    this.savedText = result.content || '';
    this.editor.value = this.savedText;
    this.revision = result.revision;
    this.loaded = true;
    this.updateDirty();
  },

  content() {
    if (!this.loaded) throw new Error('Reload the configuration first');
    if (new Blob([this.editor.value]).size > 65536) throw new Error(messages.config_too_large);
    return this.editor.value;
  },

  async queue(name, revision) {
    checked(await api.action(name, revision || ''));
    this.status.busy = true;
    this.lastJob = null;
  },

  async showCacheReset() {
    this.notify('Clearing the cache and restarting the service, please wait...');
    const plan = await api.cache();
    if (!plan || !plan.ok) {
      throw new Error(plan ? message(plan) : 'Invalid response from the backend');
    }
    await this.queue('cache_reset_start', plan.token);
  },

  async save() {
    const content = this.content();
    const result = checked(await api.save(content, this.revision));
    this.savedText = content;
    this.revision = result.revision;
    this.status.revision = result.revision;
    this.updateDirty();
    await this.queue('apply', result.revision);
    this.showTab('overview');
  },

  showTab(name) {
    const group = this.panes;
    if (!group) return;
    const menu = group.previousElementSibling;
    if (menu && menu.classList && menu.classList.contains('cbi-tabmenu')) {
      menu.querySelectorAll('[data-tab]').forEach(tab => {
        tab.classList.remove('cbi-tab');
        tab.classList.remove('cbi-tab-disabled');
        tab.classList.add(tab.getAttribute('data-tab') === name ? 'cbi-tab' : 'cbi-tab-disabled');
      });
    }
    Array.prototype.forEach.call(group.childNodes, pane => {
      if (!pane.getAttribute || pane.getAttribute('data-tab') == null) return;
      const active = pane.getAttribute('data-tab') === name;
      pane.setAttribute('data-tab-active', active ? 'true' : 'false');
      if (active) pane.dispatchEvent(new CustomEvent('cbi-tab-active', { detail: { tab: name } }));
    });
  },

  setCheckNotice(text, error, details, timeout) {
    const notice = this.checkNotice;
    if (!notice) return;
    if (this.checkNoticeTimer) {
      clearTimeout(this.checkNoticeTimer);
      this.checkNoticeTimer = null;
    }
    const color = toneColors[this.tone] || (error ? toneColors.negative : toneColors.action);
    notice.textContent = '';
    notice.appendChild(E('p', { style: 'margin:0' }, text));
    if (details) notice.appendChild(E('pre', { class: 'sing-box-output' }, details));
    notice.style.setProperty('border-left', '4px solid ' + color, 'important');
    notice.style.setProperty('background-color', color + '22', 'important');
    notice.hidden = false;
    if (timeout) {
      this.checkNoticeTimer = setTimeout(() => {
        notice.hidden = true;
        this.checkNoticeTimer = null;
      }, timeout);
    }
  },

  updateStatus(status) {
    this.status = status;
    this.runtime.textContent = status.running ? 'Running · PID ' + status.pid : 'Stopped';
    this.version.textContent = status.version || 'Core not detected';
    this.uptime.textContent = status.running ? formatUptime(status.uptime) : 'Not running';
    if (!this.localBusy) {
      this.boot.checked = !!status.autostart;
      if (this.bootText) this.bootText.textContent = this.boot.checked ? 'Enabled' : 'Disabled';
    }
    this.problem.textContent = status.error_code ? message({ code: status.error_code }) : status.error || '';
    this.problem.hidden = !this.problem.textContent;
    if (status.job && status.job !== this.lastJob) {
      this.lastJob = status.job;
      try {
        const job = JSON.parse(status.job);
        if (job.state === 'error' || job.state === 'success') {
          if (this.pendingCheck) {
            this.pendingCheck = false;
            this.setCheckNotice(message(job), job.state === 'error', job.details, 5000);
          } else {
            this.notify(message(job), job.state === 'error', job.details);
          }
        }
      } catch {
        this.notify('Unable to parse the background job status', true);
      }
    }
    this.updateDirty();
    this.updateControls();
  },

  async refresh() {
    this.updateStatus(checked(await api.status()));
  },

  async refreshLogs() {
    if (this.loadingLogs) return;
    this.loadingLogs = true;
    try {
      const result = checked(await api.logs());
      this.logHint.textContent =
        result.mode === 'file'
          ? 'Logs are written to file: ' + result.output + '. Only the system log is shown below.'
          : result.mode === 'disabled'
            ? 'Logging is disabled; the log below may be old.'
            : result.log_stderr === false
              ? 'log_stderr is off; log collection depends on the device init script.'
              : '';
      // oxlint-disable-next-line no-control-regex -- Strip ANSI color codes from system logs.
      const ansi = /(?:\x1b\[|\x9b)[0-9;:]*m/g;
      this.logs.value = (result.content || '').replace(ansi, '') || 'No sing-box system log entries yet.';
      this.logUpdated.textContent = 'Updated at ' + new Date().toLocaleTimeString();
    } catch (error) {
      this.logHint.textContent = 'Log refresh failed: ' + error.message;
    } finally {
      this.loadingLogs = false;
    }
  },

  render(data) {
    this.writable = L.hasViewPermission() === true;
    this.status = data[0];
    this.buttons = [];
    this.loaded = false;
    this.localBusy = false;
    this.runtime = E('strong');
    this.version = E('span');
    this.uptime = E('strong');
    this.problem = E('p', { class: 'cbi-section-descr', role: 'alert', hidden: true });
    this.dirty = E('div', { class: 'cbi-section-descr sing-box-dirty', 'aria-live': 'polite' });
    this.checkNotice = E('div', { class: 'sing-box-check-notice', role: 'status', 'aria-live': 'polite', hidden: true });
    this.editor = E('textarea', {
      class: 'cbi-input-textarea',
      rows: 24,
      spellcheck: 'false',
      'aria-label': 'sing-box JSON configuration',
      input: () => this.updateDirty(),
    });
    const checkbox = new ui.Checkbox('0', { id: 'sing-box-autostart' }).render();
    this.boot = checkbox.querySelector('input[type="checkbox"]');
    this.boot.setAttribute('aria-label', 'Start on boot');
    this.bootText = E('span', { style: 'margin-left: 8px;' }, this.boot.checked ? 'Enabled' : 'Disabled');
    checkbox.appendChild(this.bootText);
    this.boot.addEventListener('change', () => {
      const enabled = this.boot.checked;
      this.bootText.textContent = enabled ? 'Enabled' : 'Disabled';
      this.run(async () => {
        checked(await api.autostart(enabled));
        this.notify(messages.autostart_updated);
      }, true);
    });

    const overview = E('div', { 'data-tab': 'overview', 'data-tab-title': 'Overview' }, [
      field('Status', this.runtime),
      field('Core version', this.version),
      field('Uptime', this.uptime),
      field('Start on boot', checkbox),
      field(
        'Service actions',
        E('div', { class: 'sing-box-actions' }, [
          this.button('Start', () => this.queue('start'), 'apply'),
          this.button('Restart', () => this.queue('restart'), 'warning'),
          this.button('Stop', () => this.queue('stop'), 'negative'),
          this.button('Update config', async () => {
            const inputEl = document.getElementById('custom-download-url');
            const url = (inputEl && inputEl.value.trim()) || uci.get('sing-box', 'main', 'download_url');
            if (!url) return alert('Enter a config download URL on the Config tab first and try again');
            this.notify('Updating the configuration, please wait...');
            try {
              uci.set('sing-box', 'main', 'download_url', url);
              await uci.save();
              await uci.apply();
            } catch (e) {
              console.warn('UCI save failed:', e);
            }
            const r = await fetch(url);
            if (!r.ok) throw new Error('Unexpected network response: ' + r.statusText);
            const txt = await r.text();
            this.editor.value = txt;
            this.updateDirty();
            await this.save();
          }, 'neutral'),
        ]),
      ),
      field('Maintenance', [
        E('div', { class: 'sing-box-actions' }, [
          this.button('Clear cache', () => this.showCacheReset(), 'negative'),
          this.button('Update core', async () => {
            const inputEl = document.getElementById('custom-core-url');
            const url = (inputEl && inputEl.value.trim()) || uci.get('sing-box', 'main', 'core_url');
            if (!url) return alert('Go to the Config tab and enter the core download URL first');
            this.notify('Downloading and updating the core in the background, please wait...');
            const res = checked(await api.updateCore(url));
            this.notify(res.details || messages.core_updated);
          }, 'warning'),
          this.button('Open dashboard', () => {
            let port = '9090';
            let secret = '';
            try {
              const cfg = JSON.parse(this.editor.value || '{}');
              const apiCfg = cfg && cfg.experimental && cfg.experimental.clash_api;
              if (apiCfg && apiCfg.external_controller) {
                const parts = apiCfg.external_controller.split(':');
                port = parts[parts.length - 1] || '9090';
              }
              if (apiCfg && apiCfg.secret) {
                secret = apiCfg.secret;
              }
            } catch (e) {
              /* Fall back to the default port 9090 if JSON parsing fails */
            }
            const host = location.hostname;
            const hash = `#/proxies${secret ? `?host=${host}&port=${port}&secret=${encodeURIComponent(secret)}` : ''}`;
            window.open(`${location.protocol}//${host}:${port}/ui/${hash}`, '_blank');
          }, 'action'),
        ]),
        E('div', { class: 'cbi-value-description' }, 'Clear cache database · Update sing-box core · Open web dashboard'),
      ]),
    ]);

    const config = E('div', { 'data-tab': 'config', 'data-tab-title': 'Config' }, [
      field('Core download URL', E('div', {}, [
        E('input', {
          type: 'text',
          class: 'cbi-input-text',
          placeholder: 'https://gh-proxy.org/github.com/77160860/proxy/releases/download/singbox/sing-box-arm64',
          id: 'custom-core-url',
          value: uci.get('sing-box', 'main', 'core_url') || ''
        }),
        this.button('Download core', async () => {
          const url = document.getElementById('custom-core-url').value.trim();
          if (!url) return alert('Enter the core download URL');
          this.notify('Downloading the core, please wait...');
          try {
            uci.set('sing-box', 'main', 'core_url', url);
            await uci.save();
            await uci.apply();
          } catch (e) {
            console.warn('UCI save failed:', e);
          }
          const res = checked(await api.updateCore(url));
          this.notify(res.details || messages.core_updated);
        }, 'warning')
      ])),
      field('Download config file', E('div', {}, [
        E('input', {
          type: 'text',
          class: 'cbi-input-text',
          placeholder: 'https://cdn.jsdelivr.net/gh/77160860/proxy@main/reF1nd-linux.json',
          id: 'custom-download-url',
          value: uci.get('sing-box', 'main', 'download_url') || ''
        }),
        this.button('Download config', async () => {
          const url = document.getElementById('custom-download-url').value.trim();
          if (!url) return alert('Enter the config download URL');
          this.notify('Fetching the configuration file...');
          try {
            uci.set('sing-box', 'main', 'download_url', url);
            await uci.save();
            await uci.apply();
          } catch (e) {
            console.warn('UCI save failed:', e);
          }
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error('Unexpected network response: ' + r.statusText);
            const txt = await r.text();
            this.editor.value = txt;
            this.updateDirty();
            this.notify('Configuration fetched. Review it, then click "Save & apply" below');
          } catch (e) {
            this.notify('Download error: ' + e.message, true);
          }
        }, 'neutral')
      ])),
      field('Upload config file', E('div', {}, [
        E('input', { type: 'file', class: 'cbi-input-file', id: 'upload-config-file' }),
        E('button', {
          type: 'button',
          class: 'cbi-button cbi-button-action',
          click: () => {
            const input = document.getElementById('upload-config-file');
            if (!input.files.length) return alert('Select a file');
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = e => {
              this.editor.value = e.target.result;
              this.updateDirty();
              this.notify('Configuration imported into the editor. Review it, then save and apply', false, null, 'action');
            };
            reader.onerror = () => alert('Failed to read the file');
            reader.readAsText(file);
          }
        }, 'Upload config')
      ])),

      E(
        'div',
        { class: 'cbi-section-descr' },
        'Edit the JSON directly. Validation does not save; Save & apply writes the file first, then restarts the service once the check passes.',
      ),
      this.dirty,
      this.checkNotice,
      this.editor,
      E('div', { class: 'cbi-page-actions sing-box-actions' }, [
        this.button(
          'Reload config',
          async () => {
            if (this.loaded && this.editor.value !== this.savedText && !window.confirm('Discard unsaved changes and reload the configuration?'))
              return;
            this.setConfig(await api.read());
          },
          'reset',
          false,
        ),
        this.button(
          'Validate config',
          async () => {
            this.setCheckNotice('Validating the configuration, please wait...', false);
            try {
              checked(await api.check(this.content()));
              this.pendingCheck = true;
              this.status.busy = true;
              this.lastJob = null;
            } catch (e) {
              this.pendingCheck = false;
              this.setCheckNotice(e.message, true, null, 5000);
            }
          },
          'warning',
          true,
          true,
        ),
        this.button(
          'Format config',
          () => {
            this.editor.value = JSON.stringify(JSON.parse(this.content()), null, 2) + '\n';
            this.updateDirty();
          },
          'neutral',
          true,
          true,
        ),
        this.button('Save & apply', () => this.save(), 'apply', true, true),
      ]),
    ]);

    this.logHint = E('div', { class: 'cbi-section-descr', role: 'status' });
    this.logUpdated = E('div', { class: 'cbi-section-descr' });
    this.logs = E('textarea', {
      class: 'cbi-input-textarea',
      rows: 20,
      readonly: '',
      'aria-label': 'sing-box system log',
    });
    const logs = E('div', { 'data-tab': 'logs', 'data-tab-title': 'Logs' }, [this.logHint, this.logUpdated, this.logs]);
    logs.addEventListener('cbi-tab-active', () => this.refreshLogs());

    const panes = E('div', {}, [overview, config, logs]);
    this.panes = panes;
    const root = E('div', { class: 'cbi-map', id: 'sing-box-panel' }, [
      E('link', { rel: 'stylesheet', href: L.resource('view/sing-box/panel.css') }),
      E('h2', {}, 'Sing'),
      E('p', { class: 'cbi-map-descr' }, this.writable ? 'Configuration and service management' : 'This account has read-only access.'),
      this.problem,
      E('div', { class: 'cbi-section' }, [panes]),
    ]);

    ui.tabs.initTabGroup(panes.childNodes);
    try {
      this.setConfig(data[1]);
    } catch (error) {
      this.notify(error.message, true);
    }
    try {
      if (this.status.job && JSON.parse(this.status.job).state === 'success') this.lastJob = this.status.job;
    } catch {
      /* updateStatus reports malformed task data. */
    }
    this.updateStatus(this.status);
    poll.add(async () => {
      try {
        await this.refresh();
      } catch (error) {
        this.problem.textContent = 'Status refresh failed: ' + error.message;
        this.problem.hidden = false;
      }
      if (logs.getAttribute('data-tab-active') === 'true') await this.refreshLogs();
    }, 2);
    return root;
  },
});
