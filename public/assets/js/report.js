/**
 * report.js — Pinpointer Report Renderer v6.0
 * Renders the full audit report with:
 * - Confidence badges per skill
 * - Severity-weighted data checks with visual indicators
 * - Score breakdown (AI score + auto score)
 * - AI findings and recommendations
 */
const Report = {

    skillMeta: {
        seo_analyzer:          { label: 'SEO',            short: 'seo',           icon: 'search' },
        ux_auditor:            { label: 'UX & Usability', short: 'ux',            icon: 'layout' },
        ui_auditor:            { label: 'UI Design',      short: 'ui',            icon: 'palette' },
        cro_analyzer:          { label: 'Conversion',     short: 'cro',           icon: 'target' },
        accessibility_auditor: { label: 'Accessibility',  short: 'accessibility', icon: 'person-standing' },
        performance_analyzer:  { label: 'Performance',    short: 'performance',   icon: 'zap' },
        content_quality:       { label: 'Content',        short: 'content',       icon: 'file-text' },
        security_auditor:      { label: 'Security',       short: 'security',      icon: 'shield' },
        mobile_responsiveness: { label: 'Mobile',         short: 'mobile',        icon: 'smartphone' },
        competitive_benchmark: { label: 'Standards',      short: 'benchmark',     icon: 'bar-chart-2' },
    },

    shortToFull: {
        seo: 'seo_analyzer', ux: 'ux_auditor', ui: 'ui_auditor', cro: 'cro_analyzer',
        accessibility: 'accessibility_auditor', performance: 'performance_analyzer',
        content: 'content_quality', security: 'security_auditor', mobile: 'mobile_responsiveness',
        benchmark: 'competitive_benchmark',
    },

    chartInstance: null,

    /* ── Main render ── */
    render(data) {
        if (!data) return;

        this._setText('report-url', data.url || 'Unknown');
        this._setText('report-date', this._formatDate(data.generated_at));

        const score = Math.round(data.overall_score || 0);
        const scoreEl = document.getElementById('overall-score-num');
        if (scoreEl) {
            scoreEl.textContent = score;
            scoreEl.className = 'score-big score-' + this._cls(score);
        }
        this._renderScoreChart(score);

        const sumEl = document.getElementById('executive-summary');
        if (sumEl) {
            const summary = data.executive_summary
                || data.report?.executive_summary
                || 'Audit complete. Review category scores below for detailed findings.';
            sumEl.innerHTML = summary.split('\n').filter(Boolean).map(p => `<p>${this._esc(p)}</p>`).join('');
        }

        this._renderScoreBars(data.scores);

        const priorities = data.report?.top_priorities || [];
        this._renderPriorities(priorities);

        const skills = data.report?.skills || {};
        this._renderSkillSections(skills);

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    /* ── Score doughnut chart ── */
    _renderScoreChart(score) {
        const canvas = document.getElementById('overall-score-chart');
        if (!canvas || typeof Chart === 'undefined') return;
        if (this.chartInstance) this.chartInstance.destroy();

        this.chartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [score, 100 - score],
                    backgroundColor: [this._color(score), 'rgba(255,255,255,0.04)'],
                    borderWidth: 0,
                }],
            },
            options: {
                cutout: '82%', responsive: true, maintainAspectRatio: true,
                plugins: { tooltip: { enabled: false }, legend: { display: false } },
                animation: { duration: 1400, easing: 'easeOutQuart' },
            },
        });
    },

    /* ── Category score bars ── */
    _renderScoreBars(scores) {
        const grid = document.getElementById('scores-grid');
        if (!grid || !scores) return;
        grid.innerHTML = '';

        for (const [shortKey, val] of Object.entries(scores)) {
            const s = Math.round(val || 0);
            const cls = this._cls(s);
            const fullKey = this.shortToFull[shortKey] || shortKey;
            const meta = this.skillMeta[fullKey] || {};
            const label = meta.label || shortKey;

            grid.innerHTML += `
                <div class="score-card">
                    <div class="score-header">
                        <span class="score-name">${this._esc(label)}</span>
                        <span class="score-val score-${cls}">${s}</span>
                    </div>
                    <div class="score-bar">
                        <div class="score-bar-fill bar-${cls}" style="width:${s}%"></div>
                    </div>
                </div>`;
        }
    },

    /* ── Top priorities ── */
    _renderPriorities(priorities) {
        const section = document.getElementById('top-priorities');
        const list = document.getElementById('priorities-list');
        if (!section || !list) return;

        if (!priorities?.length) { section.style.display = 'none'; return; }
        section.style.display = '';
        list.innerHTML = priorities.map((p, i) => {
            const title = typeof p === 'string' ? p : (p.title || p.action || p.text || '');
            const desc = p.description || p.impact || '';
            return `
                <div class="priority-card">
                    <div class="priority-num">${i + 1}</div>
                    <div class="priority-content">
                        <div class="priority-text">${this._esc(title)}</div>
                        ${desc ? `<div class="priority-desc">${this._esc(desc)}</div>` : ''}
                    </div>
                </div>`;
        }).join('');
    },

    /* ── Detailed skill sections ── */
    _renderSkillSections(skills) {
        const container = document.getElementById('skill-sections');
        if (!container) return;
        container.innerHTML = '';

        for (const [key, skill] of Object.entries(skills)) {
            if (!skill) continue;
            const result = skill.result || {};
            const score = Math.round(skill.score ?? result.overall_score ?? 0);
            const cls = this._cls(score);
            const meta = this.skillMeta[key] || {};
            const icon = meta.icon || 'check-circle';
            const name = skill.name || meta.label || key;
            const confidence = result.confidence || 'medium';
            const autoScore = result.auto_score;
            const aiScore = result.ai_score;

            const section = document.createElement('div');
            section.className = 'skill-section';
            section.innerHTML = `
                <div class="skill-section-header" onclick="this.parentElement.classList.toggle('open')">
                    <h3><i data-lucide="${icon}"></i> ${this._esc(name)}</h3>
                    <div style="display:flex;align-items:center;gap:12px;">
                        ${this._renderConfidenceBadge(confidence)}
                        <span class="score-badge score-${cls}" style="background:${this._bgColor(cls)}">${score}/100</span>
                        <i data-lucide="chevron-down" class="chevron"></i>
                    </div>
                </div>
                <div class="skill-section-body">
                    ${this._renderScoreBreakdown(autoScore, aiScore, score)}
                    ${this._renderDataChecks(result.data_checks)}
                    ${this._renderFindings(result.findings)}
                    ${this._renderRecommendations(result.recommendations)}
                </div>`;
            container.appendChild(section);
        }
    },

    /* ── Phase 6: Confidence Badge ── */
    _renderConfidenceBadge(confidence) {
        const map = {
            'high': { label: 'High Confidence', cls: 'confidence-high', icon: 'shield-check' },
            'medium-high': { label: 'Med-High Confidence', cls: 'confidence-medhigh', icon: 'shield' },
            'medium': { label: 'Medium Confidence', cls: 'confidence-medium', icon: 'info' },
            'low': { label: 'Low Confidence', cls: 'confidence-low', icon: 'alert-triangle' },
        };
        const cfg = map[confidence] || map['medium'];
        return `<span class="confidence-badge ${cfg.cls}" title="${cfg.label}"><i data-lucide="${cfg.icon}" style="width:12px;height:12px"></i> ${cfg.label}</span>`;
    },

    /* ── Score Breakdown ── */
    _renderScoreBreakdown(autoScore, aiScore, finalScore) {
        if (autoScore == null) return '';
        let html = '<div class="score-breakdown">';
        html += `<span class="score-breakdown-item"><strong>Data Score:</strong> ${autoScore}/100</span>`;
        if (aiScore != null) {
            html += `<span class="score-breakdown-item"><strong>AI Score:</strong> ${aiScore}/100</span>`;
            html += `<span class="score-breakdown-item"><strong>Blended:</strong> ${finalScore}/100 <span style="opacity:0.5;font-size:11px">(60% AI + 40% Data)</span></span>`;
        }
        html += '</div>';
        return html;
    },

    /* ── Data Checks (severity-weighted) ── */
    _renderDataChecks(checks) {
        if (!Array.isArray(checks) || !checks.length) return '';

        const passed = checks.filter(c => c.status === 'pass');
        const warnings = checks.filter(c => c.status === 'warning');
        const failed = checks.filter(c => c.status === 'fail');

        let html = '<div class="data-checks-section">';
        html += '<div class="data-checks-title"><i data-lucide="clipboard-check" class="icon-xs"></i> Automated Checks</div>';

        // Summary bar
        const total = checks.length;
        const passedPct = Math.round((passed.length / total) * 100);
        const warnPct = Math.round((warnings.length / total) * 100);
        const failPct = Math.round((failed.length / total) * 100);
        html += `<div class="checks-summary-bar">
            <div class="checks-bar-fill checks-pass" style="width:${passedPct}%"></div>
            <div class="checks-bar-fill checks-warn" style="width:${warnPct}%"></div>
            <div class="checks-bar-fill checks-fail" style="width:${failPct}%"></div>
        </div>
        <div class="checks-summary-labels">
            <span class="check-label pass">${passed.length} Passed</span>
            <span class="check-label warn">${warnings.length} Warnings</span>
            <span class="check-label fail">${failed.length} Failed</span>
        </div>`;

        // Render checks table with severity
        html += '<div class="checks-table">';
        for (const c of failed) html += this._renderCheckRow(c, 'fail');
        for (const c of warnings) html += this._renderCheckRow(c, 'warning');
        for (const c of passed) html += this._renderCheckRow(c, 'pass');
        html += '</div></div>';

        return html;
    },

    _renderCheckRow(check, type) {
        const statusIcon = {
            pass: '<span class="check-status-icon pass">&#10003;</span>',
            warning: '<span class="check-status-icon warn">&#9888;</span>',
            fail: '<span class="check-status-icon fail">&#10007;</span>',
        }[type] || '';

        const sevBadge = check.severity ? `<span class="severity-badge sev-${check.severity}">${check.severity}</span>` : '';
        const detail = check.detail ? `<div class="check-detail">${this._esc(check.detail)}</div>` : '';

        return `
            <div class="check-row check-${type}">
                <div class="check-status">${statusIcon}</div>
                <div class="check-info">
                    <div class="check-test">${this._esc(check.test || '')} ${sevBadge}</div>
                    <div class="check-value">${this._esc(check.value || '')}</div>
                    ${detail}
                </div>
            </div>`;
    },

    /* ── AI Findings groups ── */
    _renderFindings(findings) {
        if (!findings || typeof findings !== 'object') return '';

        const groups = [
            { key: 'critical',      title: 'Critical Issues',  icon: 'x-circle',        color: 'var(--danger)',  type: 'critical' },
            { key: 'weaknesses',    title: 'Weaknesses',       icon: 'zap-off',          color: 'var(--danger)',  type: 'critical' },
            { key: 'warnings',      title: 'Warnings',         icon: 'alert-triangle',   color: 'var(--warning)', type: 'warning' },
            { key: 'opportunities', title: 'Opportunities',    icon: 'lightbulb',         color: 'var(--info, var(--accent-primary))', type: 'warning' },
            { key: 'passed',        title: 'Passed Checks',    icon: 'check-circle',      color: 'var(--success)', type: 'passed' },
            { key: 'strengths',     title: 'Strengths',        icon: 'star',              color: 'var(--success)', type: 'passed' },
        ];

        let html = '';
        let hasContent = false;
        for (const g of groups) {
            const items = findings[g.key];
            if (!Array.isArray(items) || !items.length) continue;
            hasContent = true;
            html += `
                <div class="findings-group">
                    <div class="findings-group-title">
                        <i data-lucide="${g.icon}" class="icon-xs" style="color:${g.color}"></i>
                        ${g.title} (${items.length})
                    </div>
                    ${items.map(f => this._renderFindingItem(f, g.type)).join('')}
                </div>`;
        }

        if (hasContent) {
            return `<div class="ai-insights-section">
                <div class="ai-insights-title"><i data-lucide="sparkles" class="icon-xs"></i> AI Insights & Actions</div>
                ${html}
            </div>`;
        }
        return '';
    },

    _renderFindingItem(f, type) {
        if (!f || typeof f !== 'object') return '';
        const title = f.issue || f.test || f.aspect || f.area || f.check || f.criterion || f.test_name || f.title || f.vulnerability || '';
        const detail = f.details || f.impact || f.risk || f.value_found || f.description || '';
        const fix = f.fix || f.recommendation || '';

        return `
            <div class="finding finding-${type}">
                ${title ? `<div class="finding-title">${this._esc(title)}</div>` : ''}
                ${detail ? `<div class="finding-detail">${this._esc(detail)}</div>` : ''}
                ${fix ? `<div class="finding-fix"><strong>Fix:</strong> ${this._esc(fix)}</div>` : ''}
            </div>`;
    },

    /* ── Recommendations ── */
    _renderRecommendations(recs) {
        if (!Array.isArray(recs) || !recs.length) return '';
        return `
            <div class="recommendations-section">
                <div class="findings-group-title" style="border-top:1px solid var(--border-subtle);padding-top:20px;margin-top:16px;">
                    <i data-lucide="lightbulb" style="color:var(--accent-primary)"></i> Recommendations
                </div>
                ${recs.map((r, i) => {
                    const text = r.action || r.text || (typeof r === 'string' ? r : '');
                    const impact = r.impact || r.estimated_savings || r.risk_if_ignored || '';
                    const priority = r.priority || '';
                    return `
                        <div class="finding finding-warning">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                                <span class="rec-num">${i + 1}</span>
                                ${priority ? `<span class="rec-priority rec-priority-${priority.toLowerCase()}">${this._esc(priority)}</span>` : ''}
                            </div>
                            <div class="finding-title">${this._esc(text)}</div>
                            ${impact ? `<div class="finding-detail">Impact: ${this._esc(impact)}</div>` : ''}
                        </div>`;
                }).join('')}
            </div>`;
    },

    /* ── Helpers ── */
    _cls(s) {
        if (s >= 90) return 'excellent';
        if (s >= 70) return 'good';
        if (s >= 40) return 'fair';
        return 'poor';
    },
    _color(s) {
        if (s >= 90) return '#4ade80';
        if (s >= 70) return '#84cc16';
        if (s >= 40) return '#fbbf24';
        return '#f87171';
    },
    _bgColor(cls) {
        return { excellent: 'rgba(74,222,128,0.1)', good: 'rgba(132,204,22,0.1)', fair: 'rgba(251,191,36,0.1)', poor: 'rgba(248,113,113,0.1)' }[cls] || 'rgba(255,255,255,0.05)';
    },
    _formatDate(d) {
        if (!d) return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        try {
            const date = new Date(d.replace(/-/g, '/'));
            return 'Generated ' + date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return d; }
    },
    _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    },
    _esc(s) {
        if (!s) return '';
        if (typeof s !== 'string') return String(s);
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    },
};

window.Report = Report;
