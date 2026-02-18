/**
 * app.js — Pinpointer Audit App v4.0
 * Flow: Validate API Key -> Enter URL -> Audit -> Report
 */

/* ── API Key Manager ── */
class ApiKeyManager {
    constructor(onValidated) {
        this.onValidated = onValidated;
        this.validated = false;
        this._debounceTimer = null;

        this.els = {
            input: document.getElementById('gemini-key-input'),
            wrapper: document.querySelector('.api-key-input-wrapper'),
            statusIcon: document.getElementById('key-status-icon'),
            message: document.getElementById('key-message'),
            toggleBtn: document.getElementById('toggle-key-vis'),
        };

        this._bind();
        this._loadSaved();
    }

    _bind() {
        if (!this.els.input) { console.warn('ApiKeyManager: #gemini-key-input not found'); return; }
        // Auto-validate on input (debounced)
        this.els.input.addEventListener('input', () => {
            clearTimeout(this._debounceTimer);
            const val = this.els.input.value.trim();

            if (!val) {
                this._setStatus('idle');
                this.validated = false;
                this.onValidated(false, null);
                return;
            }

            // Quick format check before hitting API
            if (!val.startsWith('AIza') || val.length < 30) {
                this._setStatus('idle');
                this._setMessage('Key should start with "AIza..."', 'info');
                return;
            }

            this._debounceTimer = setTimeout(() => this._validate(val), 600);
        });

        // Paste handler — validate immediately
        if (this.els.input) this.els.input.addEventListener('paste', () => {
            setTimeout(() => {
                const val = this.els.input.value.trim();
                if (val.startsWith('AIza') && val.length >= 30) {
                    this._validate(val);
                }
            }, 50);
        });

        // Toggle visibility
        if (this.els.toggleBtn) this.els.toggleBtn.addEventListener('click', () => {
            const isPassword = this.els.input.type === 'password';
            this.els.input.type = isPassword ? 'text' : 'password';
            // Swap icon
            const icon = this.els.toggleBtn.querySelector('[data-lucide]');
            if (icon) icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    }

    _loadSaved() {
        const saved = localStorage.getItem('pinpointer_gemini_key');
        if (saved) {
            this.els.input.value = saved;
            this._validate(saved);
        }
    }

    async _validate(key) {
        this._setStatus('validating');
        this._setMessage('Validating API key...', 'info');

        try {
            const res = await fetch('/api/validate-key.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gemini_key: key }),
            });
            const data = await res.json();

            if (data.valid) {
                this._setStatus('valid');
                this._setMessage('API key verified — Gemini connected', 'success');
                this.validated = true;
                localStorage.setItem('pinpointer_gemini_key', key);
                this.onValidated(true, key);
            } else {
                this._setStatus('invalid');
                this._setMessage(data.error || 'Invalid API key', 'error');
                this.validated = false;
                localStorage.removeItem('pinpointer_gemini_key');
                this.onValidated(false, null);
            }
        } catch (err) {
            this._setStatus('invalid');
            this._setMessage('Could not reach server to validate key', 'error');
            this.validated = false;
            this.onValidated(false, null);
        }
    }

    _setStatus(state) {
        this.els.wrapper.classList.remove('valid', 'invalid', 'validating');
        this.els.statusIcon.className = 'key-status-icon';
        this.els.statusIcon.innerHTML = '';

        if (state === 'validating') {
            this.els.wrapper.classList.add('validating');
            this.els.statusIcon.classList.add('validating');
        } else if (state === 'valid') {
            this.els.wrapper.classList.add('valid');
            this.els.statusIcon.classList.add('valid');
            this.els.statusIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (state === 'invalid') {
            this.els.wrapper.classList.add('invalid');
            this.els.statusIcon.classList.add('invalid');
            this.els.statusIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        }
    }

    _setMessage(text, type) {
        this.els.message.textContent = text;
        this.els.message.className = `key-message ${type}`;
    }

    getKey() {
        return this.els.input.value.trim();
    }
}

/* ── UI Manager ── */
class UIManager {
    constructor() {
        this.views = {
            hero: document.getElementById('view-hero'),
            progress: document.getElementById('view-progress'),
            report: document.getElementById('view-report'),
        };
        this.els = {
            logFeed: document.getElementById('log-feed'),
            progressCircle: document.querySelector('.circle'),
            progressText: document.querySelector('.percentage'),
            statusText: document.getElementById('status-text'),
            skillsGrid: document.getElementById('skills-grid'),
            formError: document.getElementById('form-error'),
            submitBtn: document.getElementById('submit-btn'),
            urlInput: document.getElementById('url-input'),
            resetBtn: document.getElementById('btn-reset'),
            targetUrlInfo: document.getElementById('target-url-display'),
        };
        this._loggedSkills = new Set();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    switchView(name) {
        Object.values(this.views).forEach(v => v.classList.remove('active'));
        if (this.views[name]) {
            this.views[name].classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        if (this.els.resetBtn) this.els.resetBtn.classList.toggle('hidden', name === 'hero');
    }

    log(message, type = 'info') {
        const line = document.createElement('div');
        line.className = `log-line slide-in ${type}`;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        line.innerHTML = `<span style="opacity:0.4;font-size:11px;margin-right:8px;">[${time}]</span> ${this._esc(message)}`;
        this.els.logFeed.appendChild(line);
        this.els.logFeed.scrollTop = this.els.logFeed.scrollHeight;
    }

    updateProgress(percent, status) {
        const p = Math.min(100, Math.max(0, Math.round(percent)));
        this.els.progressCircle.setAttribute('stroke-dasharray', `${p}, 100`);
        this.els.progressText.textContent = `${p}%`;
        if (status) this.els.statusText.textContent = status;
    }

    initSkillCards(skills) {
        this._loggedSkills.clear();
        this.els.skillsGrid.innerHTML = skills.map(s => `
            <div class="skill-card" id="card-${s.key}">
                <div class="skill-icon"><i data-lucide="${s.icon || 'circle'}" width="18"></i></div>
                <div class="skill-info">
                    <div class="skill-name">${s.name}</div>
                    <div class="skill-status" id="status-${s.key}">Pending</div>
                </div>
            </div>
        `).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    setSkillState(key, state) {
        const card = document.getElementById(`card-${key}`);
        const st = document.getElementById(`status-${key}`);
        if (!card || !st) return;
        card.classList.remove('active', 'done', 'failed');
        if (state === 'running') {
            card.classList.add('active'); st.textContent = 'Analyzing...'; st.style.color = 'var(--accent-primary)';
        } else if (state === 'completed') {
            card.classList.add('done'); st.textContent = 'Done'; st.style.color = 'var(--success)';
        } else if (state === 'failed') {
            card.classList.add('failed'); st.textContent = 'Failed'; st.style.color = 'var(--danger)';
        }
    }

    setFormEnabled(on) {
        this.els.urlInput.disabled = !on;
        this.els.submitBtn.disabled = !on;
    }

    setLoading(on) {
        this.els.submitBtn.disabled = on;
        this.els.submitBtn.textContent = on ? 'Starting...' : 'Analyze Site';
    }

    showError(msg) {
        this.els.formError.textContent = msg;
        this.els.formError.hidden = false;
        clearTimeout(this._errTimer);
        this._errTimer = setTimeout(() => { this.els.formError.hidden = true; }, 6000);
    }

    _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
}

/* ── Poll Manager ── */
class PollManager {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.interval = 3000;
        this._active = false;
        this._errors = 0;
    }

    start(uuid, onUpdate, onComplete, onError) {
        this._active = true;
        this._errors = 0;
        this._poll(uuid, onUpdate, onComplete, onError);
    }

    stop() { this._active = false; }

    async _poll(uuid, onUpdate, onComplete, onError) {
        if (!this._active) return;
        try {
            const res = await fetch(`${this.baseUrl}/status.php?uuid=${encodeURIComponent(uuid)}`);
            if (res.status === 429) { this._errors++; this._schedule(() => this._poll(uuid, onUpdate, onComplete, onError), this.interval * 2); return; }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            this._errors = 0;

            if (!data.success) {
                if (data.error?.includes('not found')) { this._schedule(() => this._poll(uuid, onUpdate, onComplete, onError), this.interval); return; }
                throw new Error(data.error || 'API error');
            }

            onUpdate(data);

            if (data.status === 'completed') { this._active = false; onComplete(data); }
            else if (data.status === 'failed') { this._active = false; onError(data.error_message || 'Audit failed.'); }
            else { this._schedule(() => this._poll(uuid, onUpdate, onComplete, onError), this.interval); }
        } catch (err) {
            console.error('Poll error:', err);
            this._errors++;
            if (this._errors > 15) { this._active = false; onError('Lost connection. Please refresh.'); }
            else { this._schedule(() => this._poll(uuid, onUpdate, onComplete, onError), this.interval * Math.min(this._errors, 3)); }
        }
    }

    _schedule(fn, ms) { if (this._active) setTimeout(fn, ms); }
}

/* ── Main Application ── */
class AuditApp {
    constructor() {
        this.ui = new UIManager();
        this.poller = new PollManager('/api');
        this.currentUuid = null;
        this.geminiKey = null;
        this._lastLoggedSkill = null;

        this.SKILLS = [
            { key: 'seo_analyzer',           name: 'SEO Analyzer',           icon: 'search' },
            { key: 'ux_auditor',             name: 'UX Auditor',             icon: 'layout' },
            { key: 'ui_auditor',             name: 'UI Auditor',             icon: 'palette' },
            { key: 'cro_analyzer',           name: 'CRO Analyzer',           icon: 'target' },
            { key: 'accessibility_auditor',  name: 'Accessibility Auditor',  icon: 'person-standing' },
            { key: 'performance_analyzer',   name: 'Performance Analyzer',   icon: 'zap' },
            { key: 'content_quality',        name: 'Content Quality',        icon: 'file-text' },
            { key: 'security_auditor',       name: 'Security Auditor',       icon: 'shield' },
            { key: 'mobile_responsiveness',  name: 'Mobile Responsiveness',  icon: 'smartphone' },
            { key: 'competitive_benchmark',  name: 'Competitive Benchmark',  icon: 'bar-chart-2' },
        ];

        // Init API key manager — controls form enable/disable
        this.keyManager = new ApiKeyManager((valid, key) => {
            this.geminiKey = valid ? key : null;
            this.ui.setFormEnabled(valid);
        });

        this._bind();
    }

    _bind() {
        const form = document.getElementById('audit-form');
        const resetBtn = document.getElementById('btn-reset');
        if (form) form.addEventListener('submit', e => this._onSubmit(e));
        if (resetBtn) resetBtn.addEventListener('click', () => {
            this.poller.stop();
            this.currentUuid = null;
            this._lastLoggedSkill = null;
            this.ui.switchView('hero');
        });
    }

    async _onSubmit(e) {
        e.preventDefault();
        const url = this.ui.els.urlInput.value.trim();
        if (!url) return this.ui.showError('Please enter a URL.');
        if (!this.geminiKey) return this.ui.showError('Please enter a valid Gemini API key first.');

        this.ui.setLoading(true);
        try {
            const res = await fetch('/api/analyze.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, gemini_key: this.geminiKey }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Request failed');
            this._startJob(data.job_uuid, url);
        } catch (err) {
            this.ui.showError(err.message);
        } finally {
            this.ui.setLoading(false);
        }
    }

    _startJob(uuid, url) {
        this.currentUuid = uuid;
        this._lastLoggedSkill = null;
        this.ui.switchView('progress');
        this.ui.initSkillCards(this.SKILLS);
        this.ui.els.targetUrlInfo.textContent = url;
        this.ui.log(`Audit started for ${url}`);
        this.ui.log('Dispatching Gemini AI agents...');

        this.poller.start(uuid,
            data => this._onUpdate(data),
            data => this._onComplete(data),
            err  => this._onError(err),
        );
    }

    _onUpdate(data) {
        const label = { queued: 'Queued...', crawling: 'Crawling website...', lighthouse: 'Running PageSpeed Insights...', analyzing: 'AI agents analyzing...', compiling: 'Compiling final report...' }[data.status] || data.status;
        this.ui.updateProgress(data.progress, label);

        if (data.skills_completed > 0) {
            this.SKILLS.slice(0, data.skills_completed).forEach(s => this.ui.setSkillState(s.key, 'completed'));
        }
        if (data.current_skill) {
            const skill = this.SKILLS.find(s => s.name === data.current_skill);
            if (skill) {
                this.ui.setSkillState(skill.key, 'running');
                if (this._lastLoggedSkill !== skill.key) {
                    this._lastLoggedSkill = skill.key;
                    this.ui.log(`Running: ${skill.name}`, 'info');
                }
            }
        }
    }

    async _onComplete(_data) {
        this.ui.updateProgress(100, 'Generating report...');
        this.ui.log('All agents finished.', 'success');
        this.SKILLS.forEach(s => this.ui.setSkillState(s.key, 'completed'));

        await new Promise(r => setTimeout(r, 1200));

        if (!this.currentUuid) { this.ui.log('Error: Job UUID lost.', 'error'); return; }

        try {
            const res = await fetch(`/api/report.php?uuid=${encodeURIComponent(this.currentUuid)}`);
            const rpt = await res.json();
            if (rpt.success) {
                this.ui.switchView('report');
                if (window.Report) window.Report.render(rpt);
                this.ui.log('Report loaded.', 'success');
            } else {
                this.ui.log(`Report error: ${rpt.error}`, 'error');
                this.ui.showError(rpt.error || 'Failed to load report');
            }
        } catch (err) {
            console.error('Report fetch error:', err);
            this.ui.log('Failed to fetch report.', 'error');
        }
    }

    _onError(msg) {
        this.ui.log(`Error: ${msg}`, 'error');
        this.ui.updateProgress(0, 'Audit Failed');
        this.ui.showError(msg);
    }
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    window.auditApp = new AuditApp();
});
