<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pinpointer — AI Website Auditor</title>
    <meta name="description" content="AI-powered deep analysis of your SEO, UX, Performance, and Security. Get actionable intelligence beyond just a score.">

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

    <!-- Chart.js + Lucide Icons -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
    <script src="https://unpkg.com/lucide@latest"></script>

    <link rel="stylesheet" href="assets/css/app.css?v=5.0">
</head>

<body>

    <!-- ── Navigation ── -->
    <nav class="nav">
        <div class="logo">
            <i data-lucide="scan-search" class="logo-icon"></i>
            <span>Pinpointer</span>
        </div>
        <div class="nav-actions">
            <button id="btn-reset" class="btn-link hidden">
                <i data-lucide="rotate-ccw" class="icon-sm"></i> New Audit
            </button>
        </div>
    </nav>

    <main class="app-container">

        <!-- ── VIEW: HERO ── -->
        <section id="view-hero" class="view active">
            <div class="hero-wrapper fade-in">
                <div class="hero-badge">Powered by Google Gemini</div>
                <h1 class="hero-title">Understand your<br>website deeply.</h1>
                <p class="hero-subtitle">
                    10-point AI audit covering SEO, UX, Performance, Accessibility, Security and more.
                    Actionable intelligence in minutes.
                </p>

                <!-- API Key Section -->
                <div class="api-key-section">
                    <div class="api-key-group">
                        <div class="api-key-input-wrapper">
                            <i data-lucide="key" class="api-key-icon"></i>
                            <input type="password" id="gemini-key-input" class="api-key-input"
                                placeholder="Enter your Google Gemini API key" autocomplete="off" spellcheck="false">
                            <button type="button" id="toggle-key-vis" class="toggle-vis-btn" title="Show/hide key">
                                <i data-lucide="eye" class="icon-sm"></i>
                            </button>
                            <div id="key-status" class="key-status">
                                <div class="key-status-icon" id="key-status-icon"></div>
                            </div>
                        </div>
                        <div id="key-message" class="key-message"></div>
                    </div>
                    <div class="api-key-help">
                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">
                            <i data-lucide="external-link" width="12"></i> Get a free Gemini API key
                        </a>
                    </div>
                </div>

                <!-- URL Input (disabled until key validated) -->
                <form id="audit-form" class="input-group">
                    <input type="url" id="url-input" class="url-input" placeholder="https://example.com" required
                        autocomplete="off" spellcheck="false" disabled>
                    <button type="submit" id="submit-btn" class="btn-analyze" disabled>
                        Analyze Site
                    </button>
                </form>

                <div id="form-error" class="form-error" hidden></div>

                <div class="hero-features">
                    <div class="hero-feature"><i data-lucide="search" width="16"></i> SEO Analysis</div>
                    <div class="hero-feature"><i data-lucide="layout" width="16"></i> UX Audit</div>
                    <div class="hero-feature"><i data-lucide="zap" width="16"></i> Performance</div>
                    <div class="hero-feature"><i data-lucide="shield" width="16"></i> Security</div>
                    <div class="hero-feature"><i data-lucide="person-standing" width="16"></i> Accessibility</div>
                </div>
            </div>
        </section>

        <!-- ── VIEW: PROGRESS ── -->
        <section id="view-progress" class="view">
            <div class="progress-layout">

                <div class="progress-hero">
                    <div class="progress-ring-wrapper">
                        <svg viewBox="0 0 36 36" class="circular-chart">
                            <path class="circle-bg" d="M18 2.0845
                                a 15.9155 15.9155 0 0 1 0 31.831
                                a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path class="circle" stroke-dasharray="0, 100" d="M18 2.0845
                                a 15.9155 15.9155 0 0 1 0 31.831
                                a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <text x="18" y="20.35" class="percentage">0%</text>
                        </svg>
                    </div>
                    <h2 class="status-text" id="status-text">Initializing AI agents...</h2>
                    <p id="target-url-display" class="target-url-display"></p>
                </div>

                <!-- Terminal -->
                <div class="terminal-window">
                    <div class="terminal-header">
                        <div class="dot red"></div>
                        <div class="dot yellow"></div>
                        <div class="dot green"></div>
                        <span class="terminal-title">audit_process.log</span>
                    </div>
                    <div id="log-feed" class="log-feed">
                        <div class="log-line">> Waiting for connection...</div>
                    </div>
                </div>

                <!-- Skills grid -->
                <div id="skills-grid" class="skills-grid"></div>

            </div>
        </section>

        <!-- ── VIEW: REPORT ── -->
        <section id="view-report" class="view">
            <div class="report-container">

                <!-- Report Header -->
                <header class="report-header fade-in">
                    <div>
                        <div class="badge-accent">Audit Report</div>
                        <h1 id="report-url" class="report-title">...</h1>
                        <p id="report-date" class="report-meta"></p>
                    </div>
                    <button class="btn-primary" onclick="window.print()">
                        <i data-lucide="download" class="icon-sm"></i> Export PDF
                    </button>
                </header>

                <div class="report-grid">
                    <!-- Sidebar -->
                    <aside class="report-sidebar">
                        <div class="glass-card score-hero">
                            <div class="score-ring-container">
                                <canvas id="overall-score-chart" width="180" height="180"></canvas>
                                <div class="score-center">
                                    <span id="overall-score-num" class="score-big">--</span>
                                    <span class="score-label">OVERALL</span>
                                </div>
                            </div>
                            <p class="score-desc">Weighted average across all 10 audit categories.</p>
                        </div>

                        <div class="glass-card">
                            <h4 class="card-title">Category Scores</h4>
                            <div id="scores-grid" class="scores-bar-list"></div>
                        </div>
                    </aside>

                    <!-- Main -->
                    <div class="report-main">
                        <div class="glass-card executive-section">
                            <h3 class="section-title">
                                <i data-lucide="sparkles" class="icon-sm"></i> Executive Summary
                            </h3>
                            <div id="executive-summary" class="executive-text"></div>
                        </div>

                        <div id="top-priorities" class="glass-card">
                            <h3 class="section-title">
                                <i data-lucide="list-checks" class="icon-sm"></i> Top Priorities
                            </h3>
                            <div id="priorities-list" class="priorities-grid"></div>
                        </div>

                        <div id="skill-sections"></div>
                    </div>
                </div>
            </div>
        </section>

    </main>

    <script src="assets/js/report.js?v=5.0"></script>
    <script src="assets/js/app.js?v=5.0"></script>
</body>

</html>
