/**
 * Pinpointer Server v6.0 — Docker + Puppeteer Edition
 * Enhanced: Full PSI Mining + Puppeteer Screenshots + Gemini Vision + Severity-Weighted Scoring
 * Architecture: Crawl + PSI + Puppeteer Screenshots + DataExtractor + AI Vision -> Report
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const yaml = require('js-yaml');
const cheerio = require('cheerio');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SKILLS_DIR = path.join(__dirname, 'skills');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PSI_KEY = process.env.PSI_KEY || 'AIzaSyD5uxNUjZoOmeEAMgTeP7wojj7iespcIBg';
const PUPPETEER_ENABLED = process.env.PUPPETEER_ENABLED !== 'false';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

console.log(`[Config] Model: ${GEMINI_MODEL}`);
console.log(`[Config] PSI Key: ${PSI_KEY ? PSI_KEY.slice(0, 8) + '...' : 'NONE'}`);
console.log(`[Config] Puppeteer: ${PUPPETEER_ENABLED ? 'ENABLED' : 'DISABLED'}`);

// ─── In-memory stores ───
const jobs = new Map();
const reports = new Map();

// ─── Skills ───
const SKILLS = [
    { key: 'seo_analyzer',           name: 'SEO Analyzer',           weight: 0.15 },
    { key: 'ux_auditor',             name: 'UX Auditor',             weight: 0.12 },
    { key: 'ui_auditor',             name: 'UI Auditor',             weight: 0.10 },
    { key: 'cro_analyzer',           name: 'CRO Analyzer',           weight: 0.12 },
    { key: 'accessibility_auditor',  name: 'Accessibility Auditor',  weight: 0.10 },
    { key: 'performance_analyzer',   name: 'Performance Analyzer',   weight: 0.12 },
    { key: 'content_quality',        name: 'Content Quality',        weight: 0.10 },
    { key: 'security_auditor',       name: 'Security Auditor',       weight: 0.08 },
    { key: 'mobile_responsiveness',  name: 'Mobile Responsiveness',  weight: 0.06 },
    { key: 'competitive_benchmark',  name: 'Competitive Benchmark',  weight: 0.05 },
];

// ─── Load skill prompt from .md ───
const _skillCache = new Map();
function loadSkillPrompt(key) {
    if (_skillCache.has(key)) return _skillCache.get(key);
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
        const content = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf8');
        const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (m) {
            const fm = yaml.load(m[1]);
            if (fm.key === key) { _skillCache.set(key, m[2].trim()); return m[2].trim(); }
        }
    }
    return null;
}

// ─── HTTP Fetcher ───
function fetchUrl(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Pinpointer/6.0; Website Auditor)' },
            timeout, rejectUnauthorized: false,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchUrl(new URL(res.headers.location, url).toString(), timeout).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { if (data.length < 500000) data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

// ════════════════════════════════════════════
// PUPPETEER SCREENSHOT CAPTURE (NEW IN v6.0)
// ════════════════════════════════════════════
let _browser = null;

async function getBrowser() {
    if (_browser && _browser.isConnected()) return _browser;
    const puppeteer = require('puppeteer');
    _browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--single-process',
            '--no-zygote',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    console.log('[Puppeteer] Browser launched');
    return _browser;
}

async function captureScreenshots(url, jobId) {
    if (!PUPPETEER_ENABLED) return null;

    const shortId = jobId.slice(0, 8);
    console.log(`[Puppeteer ${shortId}] Capturing screenshots for ${url}`);

    let browser, page;
    try {
        browser = await getBrowser();
        page = await browser.newPage();

        const result = {
            desktop: { screenshot: null, visualData: {} },
            mobile: { screenshot: null, visualData: {} },
        };

        // ── Desktop capture (1440x900) ──
        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        } catch (navErr) {
            console.log(`[Puppeteer ${shortId}] Navigation warning: ${navErr.message}, trying with domcontentloaded`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await new Promise(r => setTimeout(r, 3000)); // wait for rendering
            } catch (e) {
                console.error(`[Puppeteer ${shortId}] Desktop navigation failed: ${e.message}`);
                await page.close();
                return null;
            }
        }

        // Take desktop screenshot
        const desktopPath = path.join(SCREENSHOTS_DIR, `${shortId}_desktop.jpg`);
        await page.screenshot({ path: desktopPath, type: 'jpeg', quality: 75, fullPage: false });
        result.desktop.screenshot = desktopPath;
        console.log(`[Puppeteer ${shortId}] Desktop screenshot captured`);

        // Extract desktop visual data via page.evaluate
        result.desktop.visualData = await extractVisualData(page);

        // ── Mobile capture (375x812) ──
        await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        } catch {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await new Promise(r => setTimeout(r, 3000));
            } catch (e) {
                console.error(`[Puppeteer ${shortId}] Mobile navigation failed: ${e.message}`);
            }
        }

        const mobilePath = path.join(SCREENSHOTS_DIR, `${shortId}_mobile.jpg`);
        await page.screenshot({ path: mobilePath, type: 'jpeg', quality: 75, fullPage: false });
        result.mobile.screenshot = mobilePath;
        console.log(`[Puppeteer ${shortId}] Mobile screenshot captured`);

        // Extract mobile visual data
        result.mobile.visualData = await extractVisualData(page, true);

        await page.close();
        return result;

    } catch (err) {
        console.error(`[Puppeteer ${shortId}] Error:`, err.message);
        if (page) try { await page.close(); } catch {}
        return null;
    }
}

async function extractVisualData(page, isMobile = false) {
    try {
        return await page.evaluate((mobile) => {
            const data = {};

            // Font analysis
            const bodyStyle = window.getComputedStyle(document.body);
            data.body_font_family = bodyStyle.fontFamily;
            data.body_font_size = bodyStyle.fontSize;
            data.body_color = bodyStyle.color;
            data.body_bg_color = bodyStyle.backgroundColor;

            // H1 styles
            const h1 = document.querySelector('h1');
            if (h1) {
                const h1s = window.getComputedStyle(h1);
                data.h1_font_size = h1s.fontSize;
                data.h1_font_weight = h1s.fontWeight;
                data.h1_color = h1s.color;
                data.h1_line_height = h1s.lineHeight;
            }

            // Above-the-fold analysis
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            // CTAs above fold
            const buttons = document.querySelectorAll('button, a[class*="btn"], a[class*="cta"], a[class*="button"], input[type="submit"]');
            const ctasAboveFold = [];
            buttons.forEach(btn => {
                const rect = btn.getBoundingClientRect();
                if (rect.top < viewportHeight && rect.bottom > 0 && rect.width > 0) {
                    const style = window.getComputedStyle(btn);
                    ctasAboveFold.push({
                        text: btn.textContent?.trim().slice(0, 50) || '',
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        top: Math.round(rect.top),
                        bg_color: style.backgroundColor,
                        color: style.color,
                        font_size: style.fontSize,
                        is_visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
                    });
                }
            });
            data.ctas_above_fold = ctasAboveFold.slice(0, 10);

            // Nav analysis
            const nav = document.querySelector('nav') || document.querySelector('[role="navigation"]');
            if (nav) {
                const navStyle = window.getComputedStyle(nav);
                const navRect = nav.getBoundingClientRect();
                data.nav_position = navStyle.position;
                data.nav_height = Math.round(navRect.height);
                data.nav_bg = navStyle.backgroundColor;
                data.nav_is_fixed = navStyle.position === 'fixed' || navStyle.position === 'sticky';
            }

            // Tap targets (mobile specific)
            if (mobile) {
                const links = document.querySelectorAll('a, button, input, select, textarea');
                let smallTargets = 0;
                let totalTargets = 0;
                links.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        totalTargets++;
                        if (rect.width < 44 || rect.height < 44) smallTargets++;
                    }
                });
                data.tap_targets_total = totalTargets;
                data.tap_targets_too_small = smallTargets;
            }

            // Content area width (readability)
            const main = document.querySelector('main') || document.querySelector('article') || document.querySelector('.content') || document.querySelector('#content');
            if (main) {
                const mainRect = main.getBoundingClientRect();
                data.content_width = Math.round(mainRect.width);
                data.content_max_width_percent = Math.round((mainRect.width / viewportWidth) * 100);
            }

            // Horizontal overflow check
            data.has_horizontal_overflow = document.documentElement.scrollWidth > viewportWidth;

            // Image analysis
            const images = document.querySelectorAll('img');
            let oversizedImages = 0;
            let totalVisibleImages = 0;
            images.forEach(img => {
                const rect = img.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    totalVisibleImages++;
                    if (img.naturalWidth > rect.width * 2.5) oversizedImages++;
                }
            });
            data.visible_images = totalVisibleImages;
            data.oversized_images = oversizedImages;

            // Z-index stacking (potential overlap issues)
            const highZElements = [];
            document.querySelectorAll('*').forEach(el => {
                const z = parseInt(window.getComputedStyle(el).zIndex);
                if (z > 1000) highZElements.push({ tag: el.tagName, z });
            });
            data.high_z_index_elements = highZElements.length;

            return data;
        }, isMobile);
    } catch (err) {
        console.error('[Puppeteer] extractVisualData error:', err.message);
        return {};
    }
}

// ════════════════════════════════════════════
// GEMINI VISION — Send screenshots to AI
// ════════════════════════════════════════════
async function callGeminiVision(apiKey, systemPrompt, textContent, imagePaths = []) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const parts = [{ text: textContent }];

    // Add images as inline base64
    for (const imgPath of imagePaths) {
        if (!imgPath || !fs.existsSync(imgPath)) continue;
        try {
            const imgData = fs.readFileSync(imgPath);
            const base64 = imgData.toString('base64');
            parts.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64,
                },
            });
        } catch (e) {
            console.error(`[Vision] Failed to read image ${imgPath}: ${e.message}`);
        }
    }

    const payload = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192 },
    };

    const now = Date.now();
    const gap = now - _lastCallTime;
    if (gap < MIN_CALL_GAP) await new Promise(r => setTimeout(r, MIN_CALL_GAP - gap));

    for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
            const d = Math.min(5000 * Math.pow(2, attempt - 1), 45000);
            console.log(`[Vision] Retry ${attempt} after ${d}ms`);
            await new Promise(r => setTimeout(r, d));
        }
        _lastCallTime = Date.now();
        try {
            const res = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload), signal: AbortSignal.timeout(120000),
            });
            if (res.status === 429) { await new Promise(r => setTimeout(r, 8000 + attempt * 5000)); continue; }
            if (res.status === 503) { continue; }
            if (!res.ok) { const e = await res.text(); console.error(`[Vision] HTTP ${res.status}: ${e.slice(0, 200)}`); return null; }
            const data = await res.json();
            const rparts = data.candidates?.[0]?.content?.parts || [];
            let text = '';
            for (const part of rparts) { if (part.text && !part.thought) text = part.text; }
            if (!text) text = rparts.find(p => p.text)?.text || '';
            if (!text) {
                const reason = data.candidates?.[0]?.finishReason;
                console.error(`[Vision] No text. finishReason: ${reason}`);
                if (reason === 'SAFETY' || reason === 'RECITATION') return null;
                continue;
            }
            const parsed = repairJSON(text);
            if (parsed) return parsed;
            console.error('[Vision] JSON parse failed, preview:', text.slice(0, 300));
            if (attempt === 4) return null;
        } catch (err) {
            console.error(`[Vision] Error:`, err.message);
            if (attempt === 4) return null;
        }
    }
    return null;
}

// ════════════════════════════════════════════
// ENHANCED CRAWLER (same as v5.0)
// ════════════════════════════════════════════
async function crawlWebsite(url) {
    console.log(`[Crawl] ${url}`);
    const response = await fetchUrl(url);
    if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
    const html = response.body;
    const $ = cheerio.load(html);

    // Meta tags
    const metaTags = {};
    const title = $('title').first().text().trim();
    if (title) metaTags.title = title;
    $('meta').each((_, el) => { const n = $(el).attr('name') || $(el).attr('property'), c = $(el).attr('content'); if (n && c) metaTags[n] = c; });

    // Headings
    const headings = {};
    for (let i = 1; i <= 6; i++) { const h = []; $(`h${i}`).each((_, e) => h.push($(e).text().trim())); if (h.length) headings[`h${i}`] = h; }

    // Links
    const domain = new URL(url).hostname;
    const internal = [], external = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        try { const l = new URL(href, url); if (l.hostname === domain) internal.push(href); else external.push(href); } catch {}
    });

    // Images
    const images = [];
    $('img').slice(0, 30).each((_, el) => images.push({
        src: $(el).attr('src') || '', alt: $(el).attr('alt') || '',
        loading: $(el).attr('loading') || '',
        width: $(el).attr('width') || '', height: $(el).attr('height') || '',
    }));

    // Structured data
    const structuredData = [];
    $('script[type="application/ld+json"]').each((_, el) => { try { structuredData.push(JSON.parse($(el).html())); } catch {} });

    // Navigation & CTAs
    const navItems = []; $('nav a').each((_, el) => navItems.push($(el).text().trim()));
    const ctas = [];
    $('button').each((_, el) => { const t = $(el).text().trim(); if (t) ctas.push(t); });
    $('a[class*="btn"], a[class*="cta"], a[class*="button"]').each((_, el) => { const t = $(el).text().trim(); if (t) ctas.push(t); });

    // Body text
    const bodyText = $('body').clone().find('script,style,noscript').remove().end().text().replace(/\s+/g, ' ').trim().slice(0, 5000);
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    // Security headers
    const secHeaders = {};
    ['strict-transport-security','content-security-policy','x-content-type-options','x-frame-options','referrer-policy','permissions-policy','x-xss-protection']
        .forEach(h => { secHeaders[h] = response.headers[h] || null; });

    // Robots.txt & Sitemap
    const pu = new URL(url);
    let robotsTxt = '';
    try { const r = await fetchUrl(`${pu.protocol}//${pu.hostname}/robots.txt`, 5000); if (r.status === 200) robotsTxt = r.body.slice(0, 2000); } catch {}
    let sitemapExists = false;
    try { const s = await fetchUrl(`${pu.protocol}//${pu.hostname}/sitemap.xml`, 5000); sitemapExists = s.status === 200; } catch {}

    // Canonical URL
    const canonicalLink = $('link[rel="canonical"]').attr('href') || '';

    // Cookie analysis
    const cookies = [];
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
        const cookieHeaders = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const c of cookieHeaders) {
            const parts = c.split(';').map(s => s.trim());
            const [nameVal] = parts;
            const name = nameVal?.split('=')?.[0] || '';
            const flags = c.toLowerCase();
            cookies.push({
                name, secure: flags.includes('secure'),
                httponly: flags.includes('httponly'),
                samesite: flags.match(/samesite=(strict|lax|none)/i)?.[1] || '',
            });
        }
    }

    // Flesch-Kincaid Readability
    const readability = computeReadability(bodyText, wordCount);

    // Inline styles count
    let inlineStyles = 0;
    $('[style]').each(() => inlineStyles++);

    // Compression detection
    const contentEncoding = response.headers['content-encoding'] || '';
    const compression = contentEncoding.includes('br') ? 'brotli' : contentEncoding.includes('gzip') ? 'gzip' : contentEncoding.includes('deflate') ? 'deflate' : 'none';

    // HTTP/2 detection
    const isHttp2 = response.headers[':status'] !== undefined || (response.headers['alt-svc'] || '').includes('h2');

    // Resource hints
    const resourceHints = { preload: 0, prefetch: 0, preconnect: 0 };
    $('link[rel="preload"]').each(() => resourceHints.preload++);
    $('link[rel="prefetch"]').each(() => resourceHints.prefetch++);
    $('link[rel="preconnect"]').each(() => resourceHints.preconnect++);

    // Twitter Cards
    const twitterCards = {};
    $('meta[name^="twitter:"]').each((_, el) => {
        const name = $(el).attr('name')?.replace('twitter:', '') || '';
        if (name) twitterCards[name] = $(el).attr('content') || '';
    });

    // Form accessibility
    const formA11y = { total_inputs: 0, all_labeled: true, unlabeled_inputs: [] };
    $('input:not([type="hidden"]), select, textarea').each((_, el) => {
        formA11y.total_inputs++;
        const id = $(el).attr('id');
        const ariaLabel = $(el).attr('aria-label');
        const ariaLabelledby = $(el).attr('aria-labelledby');
        const hasLabel = (id && $(`label[for="${id}"]`).length > 0) || ariaLabel || ariaLabelledby || $(el).closest('label').length > 0;
        if (!hasLabel) {
            formA11y.all_labeled = false;
            formA11y.unlabeled_inputs.push($(el).attr('name') || $(el).attr('type') || 'unknown');
        }
    });

    // ARIA landmarks
    const ariaLandmarks = {};
    $('[role]').each((_, el) => {
        const role = $(el).attr('role');
        if (role) ariaLandmarks[role] = (ariaLandmarks[role] || 0) + 1;
    });

    // Semantic HTML elements
    const semanticHTML = {};
    ['header', 'footer', 'main', 'nav', 'article', 'section', 'aside', 'figure', 'figcaption', 'details', 'summary', 'mark', 'time'].forEach(tag => {
        const count = $(tag).length;
        if (count > 0) semanticHTML[tag] = count;
    });

    // Forms data
    const forms = [];
    $('form').slice(0, 10).each((_, el) => {
        forms.push({ fields: $(el).find('input:not([type="hidden"]), select, textarea').length });
    });

    // Trust signals
    const trustSignals = {
        has_testimonials: /testimonial|review|rating/i.test(html),
        has_social_proof: /client|partner|customer|trusted by/i.test(html),
        has_privacy_policy: /privacy.?policy/i.test(html),
        has_terms: /terms.?(of|and).?(service|use|conditions)/i.test(html),
    };

    console.log(`[Crawl] Done: ${wordCount} words, ${images.length} imgs, ${internal.length}/${external.length} links`);

    return {
        url, status_code: response.status, meta_tags: metaTags, headings,
        links: { internal: internal.slice(0, 50), external: external.slice(0, 50), internal_count: internal.length, external_count: external.length },
        images, structured_data: structuredData, navigation: { items: navItems }, ctas,
        body_text: bodyText, viewport: $('meta[name="viewport"]').attr('content') || '',
        robots_txt: robotsTxt, sitemap_exists: sitemapExists, security_headers: secHeaders,
        language: $('html').attr('lang') || '', word_count: wordCount,
        forms_count: $('form').length, forms,
        stylesheet_count: $('link[rel="stylesheet"]').length,
        trust_signals: trustSignals,
        canonical_link: canonicalLink, cookies, readability, inline_styles: inlineStyles,
        compression, is_http2: isHttp2, resource_hints: resourceHints,
        twitter_cards: twitterCards, form_accessibility: formA11y,
        aria_landmarks: ariaLandmarks, semantic_html: semanticHTML,
        response_headers: { server: response.headers['server'] || '', 'x-powered-by': response.headers['x-powered-by'] || '' },
    };
}

// ── Flesch-Kincaid Readability ──
function computeReadability(text, wordCount) {
    if (!text || wordCount < 30) return { flesch_ease: null, grade_level: null, avg_sentence_length: 0, avg_syllables_per_word: 0 };

    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
    const sentenceCount = Math.max(1, sentences.length);
    const words = text.split(/\s+/).filter(Boolean);
    let totalSyllables = 0;
    for (const word of words) totalSyllables += countSyllables(word);
    const avgSentenceLen = wordCount / sentenceCount;
    const avgSyllables = totalSyllables / Math.max(1, wordCount);
    const fleschEase = Math.round(Math.max(0, Math.min(100, 206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllables)));
    const gradeLevel = Math.round(Math.max(0, 0.39 * avgSentenceLen + 11.8 * avgSyllables - 15.59) * 10) / 10;

    return { flesch_ease: fleschEase, grade_level: gradeLevel, avg_sentence_length: Math.round(avgSentenceLen * 10) / 10, avg_syllables_per_word: Math.round(avgSyllables * 100) / 100 };
}

function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const m = word.match(/[aeiouy]{1,2}/g);
    return m ? m.length : 1;
}

// ════════════════════════════════════════════
// FULL PSI MINING
// ════════════════════════════════════════════
async function runPageSpeed(url) {
    if (!PSI_KEY) return null;
    console.log(`[PSI] Running for ${url}...`);
    const results = {};

    const SUB_AUDIT_MAP = {
        'is-crawlable': 'seo_is_crawlable', 'canonical': 'seo_canonical',
        'link-text': 'seo_link_text', 'font-size': 'seo_font_size',
        'meta-description': 'seo_meta_description', 'document-title': 'seo_document_title',
        'http-status-code': 'seo_http_status', 'hreflang': 'seo_hreflang',
        'robots-txt': 'seo_robots_txt', 'crawlable-anchors': 'seo_crawlable_anchors',
        'color-contrast': 'a11y_color_contrast', 'heading-order': 'a11y_heading_order',
        'image-alt': 'a11y_image_alt', 'label': 'a11y_label',
        'button-name': 'a11y_button_name', 'link-name': 'a11y_link_name',
        'duplicate-id-active': 'a11y_duplicate_id', 'html-has-lang': 'a11y_html_has_lang',
        'html-lang-valid': 'a11y_html_lang_valid', 'meta-viewport': 'a11y_meta_viewport',
        'tabindex': 'a11y_tabindex', 'td-headers-attr': 'a11y_table_headers',
        'aria-allowed-attr': 'a11y_aria_allowed', 'aria-required-attr': 'a11y_aria_required',
        'document-title': 'a11y_document_title', 'video-caption': 'a11y_video_caption',
        'tap-targets': 'a11y_tap_targets', 'list': 'a11y_list', 'listitem': 'a11y_listitem',
        'render-blocking-resources': 'perf_render_blocking',
        'unused-css-rules': 'perf_unused_css', 'unused-javascript': 'perf_unused_js',
        'total-byte-weight': 'perf_total_byte_weight', 'dom-size': 'perf_dom_size',
        'font-display': 'perf_font_display', 'uses-optimized-images': 'perf_image_optim',
        'modern-image-formats': 'perf_modern_formats', 'offscreen-images': 'perf_offscreen_images',
        'unminified-css': 'perf_minified_css', 'unminified-javascript': 'perf_minified_js',
        'uses-text-compression': 'perf_text_compression', 'redirects': 'perf_redirects',
        'uses-responsive-images': 'perf_responsive_images',
        'uses-rel-preconnect': 'perf_preconnect', 'uses-rel-preload': 'perf_preload',
        'efficient-animated-content': 'perf_animated_content',
        'third-party-summary': 'perf_third_party', 'bootup-time': 'perf_bootup',
        'mainthread-work-breakdown': 'perf_mainthread',
        'is-on-https': 'bp_https', 'no-vulnerable-libraries': 'bp_no_vulnerable_libs',
        'errors-in-console': 'bp_errors_in_console', 'csp-xss': 'bp_csp_xss',
        'geolocation-on-start': 'bp_geolocation', 'notification-on-start': 'bp_notification',
        'deprecations': 'bp_deprecations', 'image-aspect-ratio': 'bp_image_aspect_ratio',
        'image-size-responsive': 'bp_image_size_responsive',
    };

    for (const strategy of ['mobile', 'desktop']) {
        const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?` +
            `url=${encodeURIComponent(url)}&strategy=${strategy}&key=${PSI_KEY}` +
            `&category=performance&category=accessibility&category=seo&category=best-practices`;
        try {
            const res = await fetch(psiUrl, { signal: AbortSignal.timeout(90000) });
            if (!res.ok) { console.error(`[PSI] ${strategy}: HTTP ${res.status}`); continue; }
            const data = await res.json();
            const cats = data.lighthouseResult?.categories || {};
            const audits = data.lighthouseResult?.audits || {};

            const scores = {
                performance: Math.round((cats.performance?.score || 0) * 100),
                accessibility: Math.round((cats.accessibility?.score || 0) * 100),
                seo: Math.round((cats.seo?.score || 0) * 100),
                'best-practices': Math.round((cats['best-practices']?.score || 0) * 100),
            };

            const metrics = {};
            const metricKeys = {
                'first-contentful-paint': 'FCP', 'largest-contentful-paint': 'LCP',
                'total-blocking-time': 'TBT', 'cumulative-layout-shift': 'CLS',
                'speed-index': 'SI', 'interactive': 'TTI', 'server-response-time': 'TTFB',
            };
            for (const [auditId, metricName] of Object.entries(metricKeys)) {
                const a = audits[auditId];
                if (a) metrics[metricName] = { value: a.displayValue, numericValue: a.numericValue, score: a.score };
            }

            const opportunities = Object.values(audits)
                .filter(a => a.details?.type === 'opportunity' && a.details?.overallSavingsMs > 0)
                .map(a => ({ title: a.title, savings: a.details.overallSavingsMs + 'ms', description: (a.description || '').slice(0, 200) }))
                .slice(0, 10);

            const failedAudits = [];
            for (const [id, audit] of Object.entries(audits)) {
                if (audit.score !== null && audit.score < 1 && audit.title) {
                    failedAudits.push({ id, title: audit.title, score: audit.score, displayValue: audit.displayValue || '' });
                }
            }

            const subAudits = {};
            for (const [auditId, ourKey] of Object.entries(SUB_AUDIT_MAP)) {
                const audit = audits[auditId];
                if (!audit) continue;
                const pass = audit.score === null ? null : audit.score >= 0.9;
                const failingItems = [];
                if (audit.details?.items) {
                    for (const item of audit.details.items.slice(0, 5)) {
                        const desc = item.node?.snippet || item.node?.explanation || item.url || item.source?.url || item.label || item.description || JSON.stringify(item).slice(0, 100);
                        failingItems.push(desc);
                    }
                }
                subAudits[ourKey] = {
                    title: audit.title, pass, score: audit.score,
                    display: audit.displayValue || '', failing_items: failingItems,
                };
            }

            results[strategy] = { scores, metrics, opportunities, failed_audits: failedAudits.slice(0, 30), ...subAudits };
            console.log(`[PSI] ${strategy}: perf=${scores.performance}, seo=${scores.seo}, a11y=${scores.accessibility}, bp=${scores['best-practices']}`);
        } catch (err) {
            console.error(`[PSI] ${strategy} error:`, err.message);
        }
    }

    return Object.keys(results).length > 0 ? results : null;
}

// ════════════════════════════════════════════
// JSON REPAIR
// ════════════════════════════════════════════
function repairJSON(text) {
    if (!text) return null;
    text = text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').trim();
    try { return JSON.parse(text); } catch {}
    const matches = text.match(/\{[\s\S]*\}/g);
    if (matches) {
        const sorted = matches.sort((a, b) => b.length - a.length);
        for (const m of sorted) { try { return JSON.parse(m); } catch {} }
    }
    let repaired = text;
    repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*(?:"[^"]*)?$/, '');
    repaired = repaired.replace(/,\s*$/, '');
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
    try { const fixed = JSON.parse(repaired); console.log('[AI] Repaired truncated JSON'); return fixed; } catch {}
    const lines = repaired.split('\n');
    for (let cut = 1; cut < Math.min(lines.length, 20); cut++) {
        let attempt = lines.slice(0, -cut).join('\n').replace(/,\s*$/, '');
        const ob = (attempt.match(/\{/g) || []).length;
        const cb = (attempt.match(/\}/g) || []).length;
        const oq = (attempt.match(/\[/g) || []).length;
        const cq = (attempt.match(/\]/g) || []).length;
        for (let i = 0; i < oq - cq; i++) attempt += ']';
        for (let i = 0; i < ob - cb; i++) attempt += '}';
        try { return JSON.parse(attempt); } catch {}
    }
    const scoreMatch = text.match(/"overall_score"\s*:\s*(\d+)/);
    if (scoreMatch) { return { overall_score: parseInt(scoreMatch[1]), _partial: true }; }
    return null;
}

// ════════════════════════════════════════════
// GEMINI AI (text-only calls)
// ════════════════════════════════════════════
let _lastCallTime = 0;
const MIN_CALL_GAP = 4500;

async function callGemini(apiKey, systemPrompt, userContent, opts = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const maxTokens = opts.maxTokens || 8192;
    const payload = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userContent }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: maxTokens },
    };

    const now = Date.now();
    const gap = now - _lastCallTime;
    if (gap < MIN_CALL_GAP) await new Promise(r => setTimeout(r, MIN_CALL_GAP - gap));

    for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
            const d = Math.min(5000 * Math.pow(2, attempt - 1), 45000);
            console.log(`[AI] Retry ${attempt} after ${d}ms`);
            await new Promise(r => setTimeout(r, d));
        }
        _lastCallTime = Date.now();
        try {
            const res = await fetch(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload), signal: AbortSignal.timeout(120000),
            });
            if (res.status === 429) { await new Promise(r => setTimeout(r, 8000 + attempt * 5000)); continue; }
            if (res.status === 503) { continue; }
            if (!res.ok) { const e = await res.text(); console.error(`[AI] HTTP ${res.status}: ${e.slice(0, 200)}`); return null; }
            const data = await res.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            let text = '';
            for (const part of parts) { if (part.text && !part.thought) text = part.text; }
            if (!text) text = parts.find(p => p.text)?.text || '';
            if (!text) {
                const reason = data.candidates?.[0]?.finishReason;
                console.error(`[AI] No text. finishReason: ${reason}`);
                if (reason === 'SAFETY' || reason === 'RECITATION') return null;
                continue;
            }
            const parsed = repairJSON(text);
            if (parsed) return parsed;
            console.error('[AI] JSON parse failed, preview:', text.slice(0, 300));
            if (attempt === 4) return null;
        } catch (err) {
            console.error(`[AI] Error:`, err.message);
            if (attempt === 4) return null;
        }
    }
    return null;
}

// ─── Validate Gemini Key ───
async function validateGeminiKey(key) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    try {
        const res = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Reply with exactly: {"status":"ok"}' }] }],
                generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 20 },
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (res.status === 200) return { valid: true, model: GEMINI_MODEL };
        const err = await res.json().catch(() => ({}));
        return { valid: false, error: err.error?.message || `HTTP ${res.status}` };
    } catch (err) { return { valid: false, error: err.message }; }
}

// ════════════════════════════════════════════
// SEVERITY-WEIGHTED DATA EXTRACTOR (same as v5.0)
// ════════════════════════════════════════════

function computeWeightedScore(checks) {
    if (!checks.length) return 50;
    let totalWeight = 0, totalScore = 0;
    for (const check of checks) {
        const sevWeight = check.severity === 'critical' ? 3 : check.severity === 'major' ? 2 : 1;
        const statusScore = check.status === 'pass' ? 100 : check.status === 'warning' ? 50 : 0;
        totalWeight += sevWeight;
        totalScore += statusScore * sevWeight;
    }
    return Math.round(totalScore / totalWeight);
}

// ── Data Extractors per skill (same as v5.0 + vision-enhanced UX/UI) ──
const DataExtractor = {
    seo_analyzer(crawl, psi, _screenshots) {
        const meta = crawl.meta_tags || {};
        const headings = crawl.headings || {};
        const links = crawl.links || {};
        const images = crawl.images || [];
        const wc = crawl.word_count || 0;
        const title = meta.title || '';
        const desc = meta.description || '';
        const canonical = crawl.canonical_link || meta.canonical || '';
        const ogTitle = meta['og:title'] || '';
        const ogDesc = meta['og:description'] || '';
        const ogImage = meta['og:image'] || '';
        const tc = crawl.twitter_cards || {};
        const h1s = headings.h1 || [];
        const h2s = headings.h2 || [];
        const imgsNoAlt = images.filter(i => !i.alt).length;
        const lhSeo = psi?.mobile?.scores?.seo ?? psi?.desktop?.scores?.seo ?? null;
        const checks = [];

        const tl = title.length;
        checks.push({ test: 'Page Title', status: tl >= 30 && tl <= 60 ? 'pass' : (!title ? 'fail' : 'warning'), severity: 'critical', value: title || '(missing)', detail: `Length: ${tl} chars` + (tl > 60 ? ' (too long)' : tl < 30 && title ? ' (short)' : tl >= 30 ? ' (good)' : '') });
        const dl = desc.length;
        checks.push({ test: 'Meta Description', status: dl >= 70 && dl <= 160 ? 'pass' : (!desc ? 'fail' : 'warning'), severity: 'critical', value: desc ? desc.slice(0, 100) + '...' : '(missing)', detail: `Length: ${dl} chars` });
        checks.push({ test: 'Canonical Tag', status: canonical ? 'pass' : 'fail', severity: 'major', value: canonical || '(missing)' });
        checks.push({ test: 'H1 Tag', status: h1s.length === 1 ? 'pass' : (h1s.length === 0 ? 'fail' : 'warning'), severity: 'critical', value: `${h1s.length} H1 tag(s)`, detail: h1s.length > 0 ? `"${h1s[0].slice(0, 80)}"` : 'No H1 found' });
        checks.push({ test: 'Heading Hierarchy', status: h2s.length >= 2 ? 'pass' : 'warning', severity: 'major', value: `H1:${h1s.length} H2:${h2s.length} H3:${(headings.h3 || []).length}` });
        checks.push({ test: 'Content Length', status: wc >= 1000 ? 'pass' : (wc >= 300 ? 'warning' : 'fail'), severity: 'major', value: `${wc} words`, detail: wc >= 2500 ? 'Excellent depth' : wc >= 1000 ? 'Good' : wc >= 300 ? 'Thin' : 'Very thin' });
        checks.push({ test: 'Image Alt Text', status: imgsNoAlt === 0 && images.length > 0 ? 'pass' : (imgsNoAlt > 0 ? 'warning' : 'pass'), severity: 'major', value: `${images.length - imgsNoAlt}/${images.length} images have alt text` });
        checks.push({ test: 'Internal Links', status: links.internal_count >= 3 ? 'pass' : 'warning', severity: 'minor', value: `${links.internal_count || 0} internal links` });
        checks.push({ test: 'External Links', status: (links.external_count || 0) >= 1 ? 'pass' : 'warning', severity: 'minor', value: `${links.external_count || 0} external links` });
        checks.push({ test: 'Open Graph Tags', status: (ogTitle && ogDesc) ? 'pass' : 'fail', severity: 'major', value: `og:title: ${ogTitle ? 'yes' : 'no'}, og:description: ${ogDesc ? 'yes' : 'no'}, og:image: ${ogImage ? 'yes' : 'no'}` });
        checks.push({ test: 'Twitter Card Tags', status: tc.card ? 'pass' : 'warning', severity: 'minor', value: tc.card ? `twitter:card=${tc.card}` : 'No Twitter Cards found' });
        checks.push({ test: 'Robots.txt', status: crawl.robots_txt ? 'pass' : 'warning', severity: 'minor', value: crawl.robots_txt ? 'Present' : 'Not found' });
        checks.push({ test: 'XML Sitemap', status: crawl.sitemap_exists ? 'pass' : 'warning', severity: 'minor', value: crawl.sitemap_exists ? 'Found' : 'Not detected' });
        checks.push({ test: 'HTTPS', status: (crawl.url || '').startsWith('https://') ? 'pass' : 'fail', severity: 'critical', value: (crawl.url || '').startsWith('https://') ? 'HTTPS active' : 'NOT using HTTPS' });
        const sd = crawl.structured_data || [];
        checks.push({ test: 'Structured Data (JSON-LD)', status: sd.length > 0 ? 'pass' : 'warning', severity: 'minor', value: sd.length > 0 ? `${sd.length} schema(s)` : 'No structured data' });

        const psiChecks = ['seo_is_crawlable', 'seo_link_text', 'seo_font_size', 'seo_meta_description', 'seo_document_title'];
        for (const key of psiChecks) {
            const sub = psi?.mobile?.[key] || psi?.desktop?.[key];
            if (sub && sub.pass !== null) {
                checks.push({ test: `PSI: ${sub.title}`, status: sub.pass ? 'pass' : 'warning', severity: 'major', value: sub.display || (sub.pass ? 'Passed' : 'Failed'), detail: (sub.failing_items || []).slice(0, 3).join('; ') });
            }
        }
        if (lhSeo !== null) checks.push({ test: 'Lighthouse SEO Score', status: lhSeo >= 90 ? 'pass' : (lhSeo >= 70 ? 'warning' : 'fail'), severity: 'major', value: `${lhSeo}/100` });

        return { checks, confidence: 'medium-high', summary: { title, description: desc, word_count: wc, lighthouse_seo: lhSeo } };
    },

    // ─── UX (confidence: medium-high with Puppeteer!) ───
    ux_auditor(crawl, psi, screenshots) {
        const nav = crawl.navigation?.items || [];
        const headings = crawl.headings || {};
        const ctas = crawl.ctas || [];
        const trust = crawl.trust_signals || {};
        const semantic = crawl.semantic_html || {};
        const formA11y = crawl.form_accessibility || {};
        const checks = [];
        const hasVisual = !!screenshots;

        checks.push({ test: 'Navigation Present', status: nav.length > 0 ? 'pass' : 'fail', severity: 'critical', value: `${nav.length} nav items`, detail: nav.slice(0, 8).join(', ') });
        checks.push({ test: 'Content Hierarchy', status: (headings.h1?.length >= 1 && (headings.h2?.length || 0) >= 2) ? 'pass' : 'warning', severity: 'major', value: `H1:${headings.h1?.length || 0} H2:${headings.h2?.length || 0}` });
        checks.push({ test: 'Primary CTA Visible', status: ctas.length >= 1 ? 'pass' : 'fail', severity: 'critical', value: ctas.length > 0 ? `CTAs: ${ctas.slice(0, 3).join(', ')}` : 'No CTAs detected' });

        const hasMain = semantic.main || semantic.article;
        const hasHeader = semantic.header;
        const hasFooter = semantic.footer;
        checks.push({ test: 'Semantic Page Structure', status: (hasMain && hasHeader && hasFooter) ? 'pass' : 'warning', severity: 'major', value: `header:${hasHeader ? 'yes' : 'no'}, main:${hasMain ? 'yes' : 'no'}, footer:${hasFooter ? 'yes' : 'no'}` });

        if (formA11y.total_inputs > 0) {
            checks.push({ test: 'Form Usability', status: formA11y.all_labeled ? 'pass' : 'warning', severity: 'minor', value: formA11y.all_labeled ? 'All inputs labeled' : `${(formA11y.unlabeled_inputs || []).length} unlabeled inputs` });
        }

        checks.push({ test: 'Trust Signals', status: (trust.has_privacy_policy || trust.has_testimonials) ? 'pass' : 'warning', severity: 'minor', value: [trust.has_testimonials ? 'Testimonials' : '', trust.has_privacy_policy ? 'Privacy policy' : ''].filter(Boolean).join(', ') || 'Limited trust signals' });
        checks.push({ test: 'Internal Navigation', status: (crawl.links?.internal_count || 0) >= 5 ? 'pass' : 'warning', severity: 'minor', value: `${crawl.links?.internal_count || 0} internal links` });

        // ── Puppeteer-enhanced checks ──
        if (hasVisual) {
            const dv = screenshots.desktop?.visualData || {};
            const mv = screenshots.mobile?.visualData || {};

            // Above-fold CTA analysis
            const ctasAbove = dv.ctas_above_fold || [];
            const visibleCtas = ctasAbove.filter(c => c.is_visible);
            checks.push({ test: 'Above-Fold CTA (Desktop)', status: visibleCtas.length >= 1 ? 'pass' : 'fail', severity: 'critical', value: `${visibleCtas.length} visible CTA(s) above fold`, detail: visibleCtas.slice(0, 3).map(c => `"${c.text}" (${c.width}x${c.height}px)`).join(', ') || 'None found' });

            // Fixed/sticky navigation
            if (dv.nav_is_fixed !== undefined) {
                checks.push({ test: 'Sticky Navigation', status: dv.nav_is_fixed ? 'pass' : 'warning', severity: 'minor', value: dv.nav_is_fixed ? `Fixed nav (${dv.nav_height}px height)` : 'Navigation is not fixed/sticky' });
            }

            // Mobile tap targets
            if (mv.tap_targets_total > 0) {
                const pct = Math.round((mv.tap_targets_too_small / mv.tap_targets_total) * 100);
                checks.push({ test: 'Mobile Tap Target Size', status: pct <= 5 ? 'pass' : (pct <= 20 ? 'warning' : 'fail'), severity: 'major', value: `${mv.tap_targets_too_small}/${mv.tap_targets_total} targets too small (${pct}%)`, detail: 'Minimum recommended: 44x44px' });
            }

            // Horizontal overflow (mobile)
            if (mv.has_horizontal_overflow !== undefined) {
                checks.push({ test: 'Mobile Horizontal Overflow', status: !mv.has_horizontal_overflow ? 'pass' : 'fail', severity: 'major', value: mv.has_horizontal_overflow ? 'Page has horizontal scroll on mobile' : 'No horizontal overflow detected' });
            }

            // Content width readability
            if (dv.content_max_width_percent > 0) {
                checks.push({ test: 'Content Width', status: dv.content_max_width_percent <= 80 ? 'pass' : 'warning', severity: 'minor', value: `Content area: ${dv.content_width}px (${dv.content_max_width_percent}% of viewport)`, detail: dv.content_max_width_percent > 80 ? 'Very wide — may hurt readability' : 'Good readable width' });
            }
        }

        // Determine confidence based on visual data availability
        const confidence = hasVisual ? 'medium-high' : 'low';
        return { checks, confidence, summary: { nav_items: nav.length, cta_count: ctas.length, has_visual_data: hasVisual } };
    },

    // ─── UI (confidence: medium-high with Puppeteer!) ───
    ui_auditor(crawl, psi, screenshots) {
        const cssCount = crawl.stylesheet_count || 0;
        const images = crawl.images || [];
        const headings = crawl.headings || {};
        const inlineStyles = crawl.inline_styles || 0;
        const semantic = crawl.semantic_html || {};
        const bpScore = psi?.mobile?.scores?.['best-practices'] ?? psi?.desktop?.scores?.['best-practices'] ?? null;
        const checks = [];
        const hasVisual = !!screenshots;

        checks.push({ test: 'CSS Stylesheets', status: cssCount >= 1 ? 'pass' : 'warning', severity: 'major', value: `${cssCount} stylesheets` });
        checks.push({ test: 'Inline Style Usage', status: inlineStyles <= 5 ? 'pass' : (inlineStyles <= 20 ? 'warning' : 'fail'), severity: 'minor', value: `${inlineStyles} inline style attributes`, detail: inlineStyles > 20 ? 'Excessive — hurts maintainability' : '' });
        checks.push({ test: 'Visual Content', status: images.length >= 2 ? 'pass' : 'warning', severity: 'minor', value: `${images.length} images` });

        const noDimensions = images.filter(i => !i.width && !i.height).length;
        if (noDimensions > 0) {
            checks.push({ test: 'Image Dimensions Set', status: 'warning', severity: 'minor', value: `${noDimensions}/${images.length} missing width/height`, detail: 'Causes layout shift (CLS)' });
        }

        checks.push({ test: 'Heading Hierarchy', status: (headings.h1?.length || 0) >= 1 ? 'pass' : 'warning', severity: 'minor', value: `H1:${headings.h1?.length || 0} H2:${headings.h2?.length || 0}` });
        checks.push({ test: 'Semantic HTML Structure', status: Object.keys(semantic).length >= 3 ? 'pass' : 'warning', severity: 'minor', value: `${Object.keys(semantic).length} semantic element types` });

        if (bpScore != null) checks.push({ test: 'Lighthouse Best Practices', status: bpScore >= 90 ? 'pass' : (bpScore >= 70 ? 'warning' : 'fail'), severity: 'major', value: `${bpScore}/100` });

        const consoleErrors = psi?.mobile?.bp_errors_in_console || psi?.desktop?.bp_errors_in_console;
        if (consoleErrors && consoleErrors.pass !== null) {
            checks.push({ test: 'PSI: Console Errors', status: consoleErrors.pass ? 'pass' : 'warning', severity: 'major', value: consoleErrors.pass ? 'No console errors' : 'Console errors detected', detail: (consoleErrors.failing_items || []).slice(0, 3).join('; ') });
        }

        const contrast = psi?.mobile?.a11y_color_contrast || psi?.desktop?.a11y_color_contrast;
        if (contrast && contrast.pass !== null) {
            checks.push({ test: 'PSI: Color Contrast', status: contrast.pass ? 'pass' : 'warning', severity: 'major', value: contrast.pass ? 'Sufficient contrast' : 'Contrast issues detected', detail: (contrast.failing_items || []).slice(0, 3).join('; ') });
        }

        // ── Puppeteer-enhanced checks ──
        if (hasVisual) {
            const dv = screenshots.desktop?.visualData || {};
            const mv = screenshots.mobile?.visualData || {};

            // Typography analysis
            if (dv.body_font_family) {
                const isSystemFont = /system-ui|segoe|arial|helvetica|sans-serif/i.test(dv.body_font_family);
                checks.push({ test: 'Typography (Body)', status: 'pass', severity: 'minor', value: `Font: ${dv.body_font_family.slice(0, 60)}`, detail: `Size: ${dv.body_font_size}` });
            }

            // H1 typography
            if (dv.h1_font_size) {
                const h1Size = parseInt(dv.h1_font_size);
                checks.push({ test: 'H1 Typography', status: h1Size >= 28 ? 'pass' : 'warning', severity: 'minor', value: `Size: ${dv.h1_font_size}, Weight: ${dv.h1_font_weight}`, detail: h1Size < 28 ? 'H1 may be too small for visual hierarchy' : 'Good visual prominence' });
            }

            // CTA button sizing
            const ctasAbove = dv.ctas_above_fold || [];
            if (ctasAbove.length > 0) {
                const primaryCta = ctasAbove[0];
                const goodSize = primaryCta.width >= 120 && primaryCta.height >= 40;
                checks.push({ test: 'Primary CTA Button Size', status: goodSize ? 'pass' : 'warning', severity: 'major', value: `${primaryCta.width}x${primaryCta.height}px — "${primaryCta.text}"`, detail: goodSize ? 'Good click target size' : 'Button may be too small for prominence' });
            }

            // Oversized images
            if (dv.oversized_images > 0) {
                checks.push({ test: 'Image Size Optimization', status: 'warning', severity: 'major', value: `${dv.oversized_images} images are significantly larger than displayed`, detail: 'Serving images 2.5x+ their display size wastes bandwidth' });
            }

            // Z-index stacking issues
            if (dv.high_z_index_elements > 3) {
                checks.push({ test: 'Z-Index Complexity', status: 'warning', severity: 'minor', value: `${dv.high_z_index_elements} elements with z-index > 1000`, detail: 'May indicate stacking context issues' });
            }
        }

        const confidence = hasVisual ? 'medium-high' : 'low';
        return { checks, confidence, summary: { css_count: cssCount, image_count: images.length, inline_styles: inlineStyles, has_visual_data: hasVisual } };
    },

    performance_analyzer(crawl, psi, _screenshots) {
        const mobile = psi?.mobile || {};
        const desktop = psi?.desktop || {};
        const mScores = mobile.scores || {};
        const dScores = desktop.scores || {};
        const mMetrics = mobile.metrics || {};
        const checks = [];

        if (mScores.performance != null) checks.push({ test: 'Mobile Performance Score', status: mScores.performance >= 90 ? 'pass' : (mScores.performance >= 50 ? 'warning' : 'fail'), severity: 'critical', value: `${mScores.performance}/100` });
        if (dScores.performance != null) checks.push({ test: 'Desktop Performance Score', status: dScores.performance >= 90 ? 'pass' : (dScores.performance >= 50 ? 'warning' : 'fail'), severity: 'critical', value: `${dScores.performance}/100` });

        const cwv = { LCP: { good: 2500, poor: 4000 }, FCP: { good: 1800, poor: 3000 }, TBT: { good: 200, poor: 600 }, CLS: { good: 0.1, poor: 0.25 }, SI: { good: 3400, poor: 5800 }, TTFB: { good: 800, poor: 1800 } };
        for (const [name, cfg] of Object.entries(cwv)) {
            const m = mMetrics[name] || (desktop.metrics || {})[name];
            if (m && m.numericValue != null) {
                const status = m.numericValue > cfg.poor ? 'fail' : m.numericValue > cfg.good ? 'warning' : 'pass';
                const sev = ['LCP', 'CLS', 'TBT'].includes(name) ? 'critical' : 'major';
                checks.push({ test: `Core Web Vital: ${name}`, status, severity: sev, value: m.value || `${Math.round(m.numericValue)}`, detail: `Good: <${cfg.good}, Poor: >${cfg.poor}` });
            }
        }

        const perfSubs = { perf_render_blocking: 'critical', perf_unused_css: 'major', perf_unused_js: 'major', perf_total_byte_weight: 'major', perf_dom_size: 'minor', perf_font_display: 'minor', perf_image_optim: 'major', perf_modern_formats: 'major', perf_offscreen_images: 'major', perf_minified_css: 'minor', perf_minified_js: 'minor', perf_text_compression: 'major', perf_redirects: 'minor', perf_responsive_images: 'major', perf_preconnect: 'minor', perf_bootup: 'major', perf_mainthread: 'major' };
        for (const [key, sev] of Object.entries(perfSubs)) {
            const sub = mobile[key] || desktop[key];
            if (sub && sub.pass !== null) {
                checks.push({ test: `PSI: ${sub.title}`, status: sub.pass ? 'pass' : (sev === 'critical' ? 'fail' : 'warning'), severity: sev, value: sub.display || (sub.pass ? 'Passed' : 'Needs improvement'), detail: (sub.failing_items || []).slice(0, 3).join('; ') });
            }
        }

        checks.push({ test: 'Response Compression', status: crawl.compression !== 'none' ? 'pass' : 'warning', severity: 'major', value: crawl.compression !== 'none' ? `${crawl.compression} active` : 'No compression detected' });
        const hints = crawl.resource_hints || {};
        const totalHints = (hints.preload || 0) + (hints.prefetch || 0) + (hints.preconnect || 0);
        checks.push({ test: 'Resource Hints', status: totalHints > 0 ? 'pass' : 'warning', severity: 'minor', value: totalHints > 0 ? `preload:${hints.preload}, prefetch:${hints.prefetch}, preconnect:${hints.preconnect}` : 'No resource hints' });
        const lazy = crawl.images?.filter(i => i.loading === 'lazy').length || 0;
        const total = crawl.images?.length || 0;
        checks.push({ test: 'Image Lazy Loading', status: lazy > 0 || total <= 3 ? 'pass' : 'warning', severity: 'major', value: `${lazy}/${total} images lazy loaded` });

        return { checks, confidence: 'high', summary: { mobile_perf: mScores.performance, desktop_perf: dScores.performance } };
    },

    security_auditor(crawl, psi, _screenshots) {
        const headers = crawl.security_headers || {};
        const url = crawl.url || '';
        const cookies = crawl.cookies || [];
        const rh = crawl.response_headers || {};
        const checks = [];

        checks.push({ test: 'HTTPS Enforcement', status: url.startsWith('https://') ? 'pass' : 'fail', severity: 'critical', value: url.startsWith('https://') ? 'HTTPS active' : 'NOT using HTTPS' });
        const headerMap = { 'strict-transport-security': { name: 'HSTS', sev: 'critical' }, 'content-security-policy': { name: 'Content-Security-Policy', sev: 'critical' }, 'x-content-type-options': { name: 'X-Content-Type-Options', sev: 'major' }, 'x-frame-options': { name: 'X-Frame-Options', sev: 'major' }, 'referrer-policy': { name: 'Referrer-Policy', sev: 'major' }, 'permissions-policy': { name: 'Permissions-Policy', sev: 'minor' }, 'x-xss-protection': { name: 'X-XSS-Protection', sev: 'minor' } };
        for (const [header, cfg] of Object.entries(headerMap)) {
            const present = !!headers[header];
            checks.push({ test: cfg.name, status: present ? 'pass' : (cfg.sev === 'critical' ? 'fail' : 'warning'), severity: cfg.sev, value: present ? `Present: ${(headers[header] || '').slice(0, 80)}` : 'Not set' });
        }
        checks.push({ test: 'Server Version Disclosure', status: !rh.server || rh.server.toLowerCase() === 'cloudflare' ? 'pass' : 'warning', severity: 'minor', value: rh.server || 'Not disclosed' });
        checks.push({ test: 'X-Powered-By Disclosure', status: !rh['x-powered-by'] ? 'pass' : 'warning', severity: 'minor', value: rh['x-powered-by'] || 'Not disclosed' });
        if (cookies.length > 0) {
            const insecure = cookies.filter(c => !c.secure);
            const noHttp = cookies.filter(c => !c.httponly);
            const noSame = cookies.filter(c => !c.samesite);
            checks.push({ test: 'Cookie Secure Flag', status: insecure.length === 0 ? 'pass' : 'fail', severity: 'major', value: insecure.length === 0 ? 'All cookies use Secure' : `${insecure.length} missing Secure: ${insecure.map(c => c.name).slice(0, 3).join(', ')}` });
            checks.push({ test: 'Cookie HttpOnly Flag', status: noHttp.length === 0 ? 'pass' : 'warning', severity: 'major', value: noHttp.length === 0 ? 'All cookies use HttpOnly' : `${noHttp.length} missing HttpOnly` });
            checks.push({ test: 'Cookie SameSite', status: noSame.length === 0 ? 'pass' : 'warning', severity: 'minor', value: noSame.length === 0 ? 'All cookies have SameSite' : `${noSame.length} missing SameSite` });
        }
        for (const key of ['bp_https', 'bp_no_vulnerable_libs', 'bp_csp_xss']) {
            const sub = psi?.mobile?.[key] || psi?.desktop?.[key];
            if (sub && sub.pass !== null) {
                checks.push({ test: `PSI: ${sub.title}`, status: sub.pass ? 'pass' : 'fail', severity: 'critical', value: sub.pass ? 'Passed' : (sub.display || 'Failed'), detail: (sub.failing_items || []).slice(0, 3).join('; ') });
            }
        }
        return { checks, confidence: 'high', summary: { https: url.startsWith('https://'), headers_present: Object.values(headers).filter(Boolean).length, cookies: cookies.length } };
    },

    accessibility_auditor(crawl, psi, _screenshots) {
        const images = crawl.images || [];
        const formA11y = crawl.form_accessibility || {};
        const ariaLandmarks = crawl.aria_landmarks || {};
        const semanticHTML = crawl.semantic_html || {};
        const checks = [];

        checks.push({ test: 'HTML lang Attribute', status: crawl.language ? 'pass' : 'fail', severity: 'critical', value: crawl.language || 'Not set', detail: 'WCAG 3.1.1' });
        const missing = images.filter(i => !i.alt).length;
        checks.push({ test: 'Image Alt Text', status: missing === 0 && images.length > 0 ? 'pass' : (missing > 0 ? 'fail' : 'pass'), severity: 'critical', value: missing > 0 ? `${missing}/${images.length} images missing alt text` : `All ${images.length} images have alt text`, detail: 'WCAG 1.1.1' });

        const a11yKeys = ['a11y_color_contrast', 'a11y_heading_order', 'a11y_image_alt', 'a11y_label', 'a11y_button_name', 'a11y_link_name', 'a11y_duplicate_id', 'a11y_html_has_lang', 'a11y_html_lang_valid', 'a11y_meta_viewport', 'a11y_tap_targets'];
        const sevMap = { a11y_color_contrast: 'critical', a11y_image_alt: 'critical', a11y_label: 'critical', a11y_html_has_lang: 'critical', a11y_html_lang_valid: 'critical', a11y_meta_viewport: 'major' };
        for (const key of a11yKeys) {
            const sub = psi?.mobile?.[key] || psi?.desktop?.[key];
            if (sub && sub.pass !== null) {
                const sev = sevMap[key] || 'major';
                checks.push({ test: `PSI: ${sub.title}`, status: sub.pass ? 'pass' : (sev === 'critical' ? 'fail' : 'warning'), severity: sev, value: sub.display || (sub.pass ? 'Passed' : 'Failed'), detail: (sub.failing_items || []).slice(0, 3).join('; ') });
            }
        }

        const vp = crawl.viewport || '';
        if (vp.includes('user-scalable=no') || /maximum-scale\s*=\s*1(?:\.0)?(?:\s|,|$)/.test(vp)) {
            checks.push({ test: 'Zoom Not Disabled', status: 'fail', severity: 'major', value: 'Pinch-to-zoom is disabled', detail: 'WCAG 1.4.4' });
        }
        if (formA11y.total_inputs > 0) {
            checks.push({ test: 'Form Input Labels (HTML)', status: formA11y.all_labeled ? 'pass' : 'warning', severity: 'major', value: formA11y.all_labeled ? `All ${formA11y.total_inputs} inputs labeled` : `${(formA11y.unlabeled_inputs || []).length} unlabeled` });
        }
        checks.push({ test: 'ARIA Landmarks', status: Object.keys(ariaLandmarks).length > 0 ? 'pass' : 'warning', severity: 'minor', value: Object.keys(ariaLandmarks).length > 0 ? `${Object.keys(ariaLandmarks).length} roles: ${Object.keys(ariaLandmarks).join(', ')}` : 'None found' });
        checks.push({ test: 'Semantic HTML5 Elements', status: Object.keys(semanticHTML).length >= 3 ? 'pass' : 'warning', severity: 'minor', value: `${Object.keys(semanticHTML).length} types: ${Object.keys(semanticHTML).slice(0, 6).join(', ')}` });
        const accScore = psi?.mobile?.scores?.accessibility ?? psi?.desktop?.scores?.accessibility ?? null;
        if (accScore != null) checks.push({ test: 'Lighthouse Accessibility Score', status: accScore >= 90 ? 'pass' : (accScore >= 70 ? 'warning' : 'fail'), severity: 'critical', value: `${accScore}/100` });

        return { checks, confidence: 'medium-high', summary: { lang: crawl.language, images_missing_alt: missing, lighthouse_a11y: accScore } };
    },

    cro_analyzer(crawl, psi, screenshots) {
        const ctas = crawl.ctas || [];
        const forms = crawl.forms || [];
        const trust = crawl.trust_signals || {};
        const h1s = crawl.headings?.h1 || [];
        const checks = [];
        const hasVisual = !!screenshots;

        checks.push({ test: 'Call-to-Action Presence', status: ctas.length > 0 ? 'pass' : 'fail', severity: 'critical', value: `${ctas.length} CTA(s)`, detail: ctas.slice(0, 5).join(', ') });
        checks.push({ test: 'Lead Capture Forms', status: forms.length > 0 ? 'pass' : 'warning', severity: 'major', value: `${forms.length} form(s)` });
        for (const [i, form] of forms.slice(0, 3).entries()) {
            checks.push({ test: `Form #${i + 1} Complexity`, status: form.fields <= 5 ? 'pass' : 'warning', severity: 'minor', value: `${form.fields} fields${form.fields > 7 ? ' — high friction' : ''}` });
        }
        checks.push({ test: 'Testimonials/Reviews', status: trust.has_testimonials ? 'pass' : 'warning', severity: 'major', value: trust.has_testimonials ? 'Detected' : 'Not detected' });
        checks.push({ test: 'Social Proof', status: trust.has_social_proof ? 'pass' : 'warning', severity: 'major', value: trust.has_social_proof ? 'Present' : 'Not detected' });
        checks.push({ test: 'Privacy Policy', status: trust.has_privacy_policy ? 'pass' : 'warning', severity: 'major', value: trust.has_privacy_policy ? 'Linked' : 'Not found' });
        checks.push({ test: 'Headline/Value Proposition', status: h1s.length > 0 ? 'pass' : 'fail', severity: 'critical', value: h1s.length > 0 ? `"${h1s[0].slice(0, 80)}"` : 'No H1 — unclear value proposition' });

        // Puppeteer-enhanced CRO checks
        if (hasVisual) {
            const dv = screenshots.desktop?.visualData || {};
            const ctasAbove = dv.ctas_above_fold || [];
            const visibleCtas = ctasAbove.filter(c => c.is_visible);
            checks.push({ test: 'Above-Fold CTA Visibility', status: visibleCtas.length >= 1 ? 'pass' : 'fail', severity: 'critical', value: `${visibleCtas.length} CTA(s) visible above fold`, detail: visibleCtas.map(c => `"${c.text}"`).join(', ') || 'None visible without scrolling' });
        }

        return { checks, confidence: hasVisual ? 'medium-high' : 'medium', summary: { cta_count: ctas.length, form_count: forms.length, has_visual_data: hasVisual } };
    },

    content_quality(crawl, psi, _screenshots) {
        const wc = crawl.word_count || 0;
        const headings = crawl.headings || {};
        const images = crawl.images || [];
        const links = crawl.links || {};
        const readability = crawl.readability || {};
        const checks = [];

        checks.push({ test: 'Content Volume', status: wc >= 1000 ? 'pass' : (wc >= 300 ? 'warning' : 'fail'), severity: 'major', value: `${wc} words` });
        const totalH = Object.values(headings).reduce((a, b) => a + b.length, 0);
        checks.push({ test: 'Content Structure (Headings)', status: totalH >= 5 ? 'pass' : (totalH >= 2 ? 'warning' : 'fail'), severity: 'major', value: `${totalH} headings` });
        checks.push({ test: 'Visual Content', status: images.length >= 3 ? 'pass' : (images.length >= 1 ? 'warning' : 'fail'), severity: 'minor', value: `${images.length} images/media` });

        if (readability.flesch_ease != null) {
            const fe = readability.flesch_ease;
            const label = fe >= 60 ? 'Easy-to-read' : fe >= 30 ? 'Moderate' : 'Difficult';
            checks.push({ test: 'Flesch Reading Ease', status: fe >= 60 ? 'pass' : (fe >= 30 ? 'warning' : 'fail'), severity: 'major', value: `${fe}/100 (${label})`, detail: `Grade level: ${readability.grade_level}, Avg sentence: ${readability.avg_sentence_length} words` });
        } else if (wc > 30) {
            const sentences = (crawl.body_text || '').split(/[.!?]+/).filter(s => s.trim().length > 10);
            const avg = Math.round(wc / Math.max(1, sentences.length));
            checks.push({ test: 'Readability (estimated)', status: avg <= 20 ? 'pass' : 'warning', severity: 'major', value: `~${avg} words/sentence avg` });
        }

        checks.push({ test: 'Internal Linking', status: (links.internal_count || 0) >= 5 ? 'pass' : ((links.internal_count || 0) >= 2 ? 'warning' : 'fail'), severity: 'minor', value: `${links.internal_count || 0} internal links` });

        return { checks, confidence: 'medium', summary: { word_count: wc, headings: totalH, images: images.length, flesch_ease: readability.flesch_ease } };
    },

    mobile_responsiveness(crawl, psi, screenshots) {
        const viewport = crawl.viewport || '';
        const mScores = psi?.mobile?.scores || {};
        const checks = [];
        const hasVisual = !!screenshots;

        checks.push({ test: 'Viewport Meta Tag', status: viewport ? 'pass' : 'fail', severity: 'critical', value: viewport || 'Not set' });
        const noScale = viewport.includes('user-scalable=no');
        const maxScale1 = /maximum-scale\s*=\s*1(?:\.0)?(?:\s|,|$)/.test(viewport);
        if (noScale || maxScale1) {
            checks.push({ test: 'Pinch-to-Zoom', status: 'fail', severity: 'major', value: 'Zoom is disabled — bad for accessibility' });
        }
        if (mScores.performance != null) checks.push({ test: 'Mobile Performance', status: mScores.performance >= 90 ? 'pass' : (mScores.performance >= 50 ? 'warning' : 'fail'), severity: 'critical', value: `${mScores.performance}/100` });
        if (mScores.seo != null) checks.push({ test: 'Mobile SEO', status: mScores.seo >= 90 ? 'pass' : (mScores.seo >= 70 ? 'warning' : 'fail'), severity: 'major', value: `${mScores.seo}/100` });
        if (mScores.accessibility != null) checks.push({ test: 'Mobile Accessibility', status: mScores.accessibility >= 90 ? 'pass' : (mScores.accessibility >= 70 ? 'warning' : 'fail'), severity: 'major', value: `${mScores.accessibility}/100` });

        for (const key of ['a11y_tap_targets', 'seo_font_size']) {
            const sub = psi?.mobile?.[key];
            if (sub && sub.pass !== null) {
                checks.push({ test: `PSI: ${sub.title}`, status: sub.pass ? 'pass' : 'warning', severity: 'major', value: sub.display || (sub.pass ? 'Passed' : 'Failed'), detail: (sub.failing_items || []).slice(0, 3).join('; ') });
            }
        }

        const lazy = (crawl.images || []).filter(i => i.loading === 'lazy').length;
        const total = (crawl.images || []).length;
        checks.push({ test: 'Mobile Image Optimization', status: lazy > 0 || total <= 3 ? 'pass' : 'warning', severity: 'major', value: `${lazy}/${total} lazy loaded` });

        // Puppeteer mobile checks
        if (hasVisual) {
            const mv = screenshots.mobile?.visualData || {};
            if (mv.has_horizontal_overflow !== undefined) {
                checks.push({ test: 'No Horizontal Scroll', status: !mv.has_horizontal_overflow ? 'pass' : 'fail', severity: 'critical', value: mv.has_horizontal_overflow ? 'Horizontal scrollbar detected on mobile' : 'No horizontal overflow' });
            }
            if (mv.tap_targets_total > 0) {
                const pct = Math.round((mv.tap_targets_too_small / mv.tap_targets_total) * 100);
                checks.push({ test: 'Tap Target Size (Rendered)', status: pct <= 5 ? 'pass' : (pct <= 20 ? 'warning' : 'fail'), severity: 'major', value: `${pct}% of targets under 44px`, detail: `${mv.tap_targets_too_small} of ${mv.tap_targets_total} interactive elements` });
            }
        }

        return { checks, confidence: hasVisual ? 'high' : 'high', summary: { has_viewport: !!viewport, mobile_perf: mScores.performance, has_visual_data: hasVisual } };
    },

    competitive_benchmark(crawl, psi, _screenshots) {
        const meta = crawl.meta_tags || {};
        const trust = crawl.trust_signals || {};
        const semantic = crawl.semantic_html || {};
        const tc = crawl.twitter_cards || {};
        const checks = [];

        checks.push({ test: 'SSL/HTTPS', status: (crawl.url || '').startsWith('https://') ? 'pass' : 'fail', severity: 'critical', value: (crawl.url || '').startsWith('https://') ? 'Active' : 'Missing' });
        checks.push({ test: 'Responsive Design', status: crawl.viewport ? 'pass' : 'fail', severity: 'critical', value: crawl.viewport ? 'Viewport configured' : 'No viewport' });
        checks.push({ test: 'Structured Data', status: (crawl.structured_data || []).length > 0 ? 'pass' : 'warning', severity: 'major', value: (crawl.structured_data || []).length > 0 ? `${crawl.structured_data.length} schema(s)` : 'Not found' });
        checks.push({ test: 'Open Graph Tags', status: meta['og:title'] ? 'pass' : 'warning', severity: 'major', value: meta['og:title'] ? 'Present' : 'Missing' });
        checks.push({ test: 'Twitter Cards', status: tc.card ? 'pass' : 'warning', severity: 'minor', value: tc.card ? 'Present' : 'Missing' });
        checks.push({ test: 'Privacy/Legal Pages', status: (trust.has_privacy_policy && trust.has_terms) ? 'pass' : 'warning', severity: 'major', value: `Privacy: ${trust.has_privacy_policy ? 'yes' : 'no'}, Terms: ${trust.has_terms ? 'yes' : 'no'}` });
        checks.push({ test: 'Response Compression', status: crawl.compression !== 'none' ? 'pass' : 'warning', severity: 'major', value: crawl.compression !== 'none' ? crawl.compression : 'Not enabled' });
        const hints = crawl.resource_hints || {};
        checks.push({ test: 'Resource Hints', status: ((hints.preload || 0) + (hints.prefetch || 0) + (hints.preconnect || 0)) > 0 ? 'pass' : 'warning', severity: 'minor', value: `${(hints.preload || 0) + (hints.prefetch || 0) + (hints.preconnect || 0)} hints` });
        checks.push({ test: 'Modern Semantic HTML', status: Object.keys(semantic).length >= 3 ? 'pass' : 'warning', severity: 'minor', value: `${Object.keys(semantic).length} element types` });
        const mPerf = psi?.mobile?.scores?.performance ?? null;
        if (mPerf != null) checks.push({ test: 'Performance (vs 90+ standard)', status: mPerf >= 90 ? 'pass' : (mPerf >= 50 ? 'warning' : 'fail'), severity: 'critical', value: `Mobile: ${mPerf}/100` });
        const mAcc = psi?.mobile?.scores?.accessibility ?? null;
        if (mAcc != null) checks.push({ test: 'Accessibility (vs 90+ standard)', status: mAcc >= 90 ? 'pass' : (mAcc >= 70 ? 'warning' : 'fail'), severity: 'major', value: `Score: ${mAcc}/100` });

        return { checks, confidence: 'medium', summary: {} };
    },
};

// ════════════════════════════════════════════
// AUDIT RUNNER WITH PUPPETEER + SCORE BLENDING
// ════════════════════════════════════════════
async function runAudit(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    try {
        // Phase 1: Crawl
        job.status = 'crawling'; job.current_skill = 'Crawling website';
        const crawlData = await crawlWebsite(job.url);
        job.progress = 5;

        // Phase 2: PageSpeed Insights
        job.status = 'lighthouse'; job.current_skill = 'PageSpeed Insights';
        job.progress = 8;
        const psiData = await runPageSpeed(job.url);
        job.progress = 15;

        // Phase 2.5: Puppeteer Screenshots (NEW!)
        let screenshotData = null;
        if (PUPPETEER_ENABLED) {
            job.current_skill = 'Capturing Screenshots';
            job.progress = 18;
            screenshotData = await captureScreenshots(job.url, jobId);
            if (screenshotData) {
                console.log(`[Audit ${jobId.slice(0, 8)}] Screenshots captured: desktop=${!!screenshotData.desktop.screenshot}, mobile=${!!screenshotData.mobile.screenshot}`);
            } else {
                console.log(`[Audit ${jobId.slice(0, 8)}] Screenshot capture failed, continuing with data-only mode`);
            }
        }
        job.progress = 20;

        // Phase 3: AI skills with data-first approach
        job.status = 'analyzing';
        const skillResults = {};
        const scores = {};

        // Skills that benefit from vision (screenshots sent to Gemini)
        const VISION_SKILLS = new Set(['ux_auditor', 'ui_auditor']);

        for (let i = 0; i < SKILLS.length; i++) {
            const skill = SKILLS[i];
            job.current_skill = skill.name;
            job.skills_completed = i;
            job.progress = 20 + Math.round((i / SKILLS.length) * 70);

            console.log(`[Audit ${jobId.slice(0, 8)}] ${skill.name} (${i + 1}/${SKILLS.length})`);

            // ── Data extraction (always runs, now with screenshots context) ──
            const extractor = DataExtractor[skill.key];
            const dataResult = extractor ? extractor(crawlData, psiData, screenshotData) : { checks: [], confidence: 'low', summary: {} };
            const autoScore = computeWeightedScore(dataResult.checks);
            const confidence = dataResult.confidence;

            console.log(`[Audit] ${skill.name}: auto_score=${autoScore}, confidence=${confidence}, checks=${dataResult.checks.length}`);

            // ── AI analysis ──
            let aiResult = null;
            const prompt = loadSkillPrompt(skill.key);
            if (prompt && job.geminiKey) {
                const checksStr = JSON.stringify(dataResult.checks.slice(0, 25));
                const crawlStr = JSON.stringify(crawlData).slice(0, 20000);
                const psiStr = psiData ? JSON.stringify({
                    mobile: { scores: psiData.mobile?.scores, metrics: psiData.mobile?.metrics },
                    desktop: { scores: psiData.desktop?.scores, metrics: psiData.desktop?.metrics },
                }).slice(0, 5000) : 'Not available';

                const userContent = [
                    `Analyze this website: ${job.url}`,
                    `\nAutomated Checks (verified data):\n${checksStr}`,
                    `\nCrawl Data:\n${crawlStr}`,
                    `\nPageSpeed Insights Scores:\n${psiStr}`,
                    screenshotData ? `\nVisual Data (from Puppeteer):\nDesktop: ${JSON.stringify(screenshotData.desktop?.visualData || {}).slice(0, 3000)}\nMobile: ${JSON.stringify(screenshotData.mobile?.visualData || {}).slice(0, 3000)}` : '',
                    `\nIMPORTANT: The automated checks above are VERIFIED data. Your job is to:`,
                    `1. Interpret these results and explain their impact`,
                    `2. Identify patterns across multiple checks`,
                    `3. Provide actionable recommendations with specific fixes`,
                    `4. Only comment on what you can verify from the data above`,
                    screenshotData && VISION_SKILLS.has(skill.key) ? `5. You have been provided with desktop and mobile screenshots — use them to assess visual design, layout, and UX` : `5. Do NOT fabricate visual/design assessments unless supported by data`,
                ].filter(Boolean).join('\n');

                // Use vision call for UX/UI skills when screenshots available
                if (VISION_SKILLS.has(skill.key) && screenshotData) {
                    const imagePaths = [
                        screenshotData.desktop?.screenshot,
                        screenshotData.mobile?.screenshot,
                    ].filter(Boolean);

                    if (imagePaths.length > 0) {
                        console.log(`[Audit] ${skill.name}: Using Gemini Vision with ${imagePaths.length} screenshots`);
                        aiResult = await callGeminiVision(job.geminiKey, prompt, userContent, imagePaths);
                    }
                }

                // Fallback to text-only if vision didn't work
                if (!aiResult) {
                    aiResult = await callGemini(job.geminiKey, prompt, userContent);
                }

                if (aiResult) {
                    console.log(`[Audit] ${skill.name}: AI score ${aiResult.overall_score || '?'}`);
                }

                // Retry with simplified prompt if needed
                if (!aiResult) {
                    console.log(`[Audit] ${skill.name}: Retrying with simplified prompt...`);
                    const simplePrompt = `You are a website ${skill.name.toLowerCase()}. Based on the automated checks and crawl data, return JSON with: {"overall_score": 0-100, "findings": {"critical": [{"issue":"","details":"","fix":""}], "warnings": [{"issue":"","details":"","fix":""}], "passed": [{"issue":"","details":""}]}, "recommendations": [{"priority":"high","action":"","impact":""}]}. Base your score on the actual data. Max 4 items per category.`;
                    aiResult = await callGemini(job.geminiKey, simplePrompt, `Website: ${job.url}\nChecks: ${checksStr.slice(0, 12000)}`);
                    if (aiResult) console.log(`[Audit] ${skill.name}: Retry succeeded, AI score ${aiResult.overall_score || '?'}`);
                }
            }

            // ── Score blending ──
            let finalScore;
            if (aiResult && aiResult.overall_score != null) {
                finalScore = Math.round(aiResult.overall_score * 0.6 + autoScore * 0.4);
                console.log(`[Audit] ${skill.name}: blended=${finalScore} (AI:${aiResult.overall_score}*0.6 + auto:${autoScore}*0.4)`);
            } else {
                finalScore = autoScore;
                console.log(`[Audit] ${skill.name}: data-only score=${finalScore}`);
            }

            const combinedResult = {
                overall_score: finalScore,
                auto_score: autoScore,
                ai_score: aiResult?.overall_score ?? null,
                confidence,
                data_checks: dataResult.checks,
                findings: aiResult?.findings || buildFindingsFromChecks(dataResult.checks),
                recommendations: aiResult?.recommendations || buildRecsFromChecks(dataResult.checks),
                category_scores: aiResult?.category_scores || {},
            };

            skillResults[skill.key] = { name: skill.name, score: finalScore, result: combinedResult };
            scores[skill.key] = finalScore;
        }

        job.skills_completed = SKILLS.length;
        job.progress = 92;

        // Phase 4: Compile
        job.status = 'compiling'; job.current_skill = 'Compiling report';

        let overallScore = 0, totalWeight = 0;
        for (const s of SKILLS) { overallScore += (scores[s.key] || 0) * s.weight; totalWeight += s.weight; }
        overallScore = Math.round(overallScore / totalWeight);

        // Executive summary
        let execSummary = '', topPriorities = [];
        if (job.geminiKey) {
            const summaryResult = await callGemini(job.geminiKey,
                'You are a senior website consultant. Write a 3-paragraph executive summary and top 5 priority actions. Return JSON: {"executive_summary":"...","top_priorities":["..."]}',
                `Website: ${job.url}\nOverall: ${overallScore}/100\nScores: ${JSON.stringify(scores)}\nPageSpeed: ${psiData ? JSON.stringify(psiData.mobile?.scores || {}) : 'N/A'}\nScreenshots: ${screenshotData ? 'Captured (visual analysis performed)' : 'Not available'}`
            );
            if (summaryResult) {
                execSummary = summaryResult.executive_summary || '';
                topPriorities = summaryResult.top_priorities || [];
            }
        }

        if (!execSummary) {
            const sn = Object.fromEntries(SKILLS.map(s => [s.key, s.name]));
            const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
            const worst = Object.entries(scores).sort((a, b) => a[1] - b[1]);
            execSummary = `${job.url} scored ${overallScore}/100. Strongest: ${sn[best[0][0]]} (${best[0][1]}), ${sn[best[1][0]]} (${best[1][1]}). Weakest: ${sn[worst[0][0]]} (${worst[0][1]}), ${sn[worst[1][0]]} (${worst[1][1]}). Focus on the lowest-scoring areas for maximum impact.`;
        }
        if (!topPriorities.length) {
            const allRecs = [];
            for (const [, d] of Object.entries(skillResults)) (d.result?.recommendations || []).forEach(r => { if (r.priority === 'high') allRecs.unshift(r.action || r.text || ''); else allRecs.push(r.action || r.text || ''); });
            topPriorities = [...new Set(allRecs.filter(Boolean))].slice(0, 5);
        }

        const report = {
            success: true, url: job.url, overall_score: overallScore,
            scores: { seo: scores.seo_analyzer || 0, ux: scores.ux_auditor || 0, ui: scores.ui_auditor || 0, cro: scores.cro_analyzer || 0, performance: scores.performance_analyzer || 0, accessibility: scores.accessibility_auditor || 0, content: scores.content_quality || 0, security: scores.security_auditor || 0, mobile: scores.mobile_responsiveness || 0, benchmark: scores.competitive_benchmark || 0 },
            lighthouse: psiData ? { mobile: { scores: psiData.mobile?.scores, metrics: psiData.mobile?.metrics }, desktop: { scores: psiData.desktop?.scores, metrics: psiData.desktop?.metrics } } : null,
            report: { skills: skillResults, top_priorities: topPriorities, executive_summary: execSummary },
            executive_summary: execSummary,
            has_visual_data: !!screenshotData,
            generated_at: new Date().toISOString(),
        };

        reports.set(jobId, report);
        job.status = 'completed'; job.progress = 100; job.completed_at = new Date().toISOString();
        console.log(`[Audit ${jobId.slice(0, 8)}] COMPLETE! Overall: ${overallScore}/100 (visual: ${!!screenshotData})`);

        // Clean up screenshot files
        if (screenshotData) {
            for (const view of ['desktop', 'mobile']) {
                const p = screenshotData[view]?.screenshot;
                if (p && fs.existsSync(p)) {
                    try { fs.unlinkSync(p); } catch {}
                }
            }
        }

    } catch (err) {
        console.error(`[Audit ${jobId.slice(0, 8)}] FATAL:`, err);
        job.status = 'failed'; job.error_message = err.message;
    }
}

function buildFindingsFromChecks(checks) {
    return {
        critical: checks.filter(c => c.status === 'fail').map(c => ({ issue: c.test, details: c.value + (c.detail ? ` — ${c.detail}` : ''), fix: '' })),
        warnings: checks.filter(c => c.status === 'warning').map(c => ({ issue: c.test, details: c.value + (c.detail ? ` — ${c.detail}` : ''), fix: '' })),
        passed: checks.filter(c => c.status === 'pass').map(c => ({ issue: c.test, details: c.value })),
    };
}

function buildRecsFromChecks(checks) {
    const recs = [];
    for (const c of checks.filter(ch => ch.status === 'fail')) recs.push({ priority: 'high', action: `Fix: ${c.test}`, impact: c.value });
    for (const c of checks.filter(ch => ch.status === 'warning').slice(0, 3)) recs.push({ priority: 'medium', action: `Improve: ${c.test}`, impact: c.value });
    return recs.slice(0, 5);
}

// ════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════
const MIME = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2' };
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type' }); res.end(JSON.stringify(data)); }
function body(req) { return new Promise(r => { let b=''; req.on('data', c => b += c); req.on('end', () => r(b)); }); }
function uuid() { const b = crypto.randomBytes(16); b[6]=(b[6]&0x0f)|0x40; b[8]=(b[8]&0x3f)|0x80; return b.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5'); }

const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;

    if (req.method === 'OPTIONS') { res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}); res.end(); return; }

    // Health check endpoint
    if (p === '/health' && req.method === 'GET') {
        return json(res, { status: 'ok', version: '6.0', puppeteer: PUPPETEER_ENABLED, uptime: process.uptime() });
    }

    // POST /api/validate-key
    if ((p === '/api/validate-key' || p === '/api/validate-key.php') && req.method === 'POST') {
        try {
            const d = JSON.parse(await body(req));
            const key = (d.gemini_key || '').trim();
            if (!key) return json(res, { valid: false, error: 'No key provided' }, 400);
            return json(res, await validateGeminiKey(key));
        } catch (e) { return json(res, { valid: false, error: e.message }, 400); }
    }

    // POST /api/analyze
    if ((p === '/api/analyze' || p === '/api/analyze.php') && req.method === 'POST') {
        try {
            const d = JSON.parse(await body(req));
            let url = (d.url || '').trim();
            const geminiKey = (d.gemini_key || '').trim();
            if (!url) return json(res, { success: false, error: 'URL is required' }, 400);
            if (!geminiKey) return json(res, { success: false, error: 'Gemini API key is required' }, 400);
            if (!url.match(/^https?:\/\//)) url = 'https://' + url;

            const id = uuid();
            const job = { id, url, geminiKey, status: 'queued', progress: 0, current_skill: null, skills_total: SKILLS.length, skills_completed: 0, error_message: null, created_at: new Date().toISOString(), completed_at: null };
            jobs.set(id, job);
            console.log(`[API] New job ${id.slice(0, 8)} for ${url}`);
            runAudit(id).catch(e => { console.error(e); job.status = 'failed'; job.error_message = e.message; });
            return json(res, { success: true, job_uuid: id, message: 'Audit started' });
        } catch (e) { return json(res, { success: false, error: e.message }, 400); }
    }

    // GET /api/status
    if ((p === '/api/status' || p === '/api/status.php') && req.method === 'GET') {
        const id = u.searchParams.get('uuid');
        if (!id) return json(res, { success: false, error: 'UUID required' }, 400);
        const job = jobs.get(id);
        if (!job) return json(res, { success: false, error: 'Job not found' }, 404);
        return json(res, { success: true, status: job.status, progress: job.progress, current_skill: job.current_skill, skills_total: job.skills_total, skills_completed: job.skills_completed, error_message: job.error_message, created_at: job.created_at, completed_at: job.completed_at });
    }

    // GET /api/report
    if ((p === '/api/report' || p === '/api/report.php') && req.method === 'GET') {
        const id = u.searchParams.get('uuid');
        if (!id) return json(res, { success: false, error: 'UUID required' }, 400);
        const job = jobs.get(id);
        if (!job) return json(res, { success: false, error: 'Job not found' }, 404);
        if (job.status !== 'completed') return json(res, { success: false, error: 'Not ready', status: job.status });
        const report = reports.get(id);
        if (!report) return json(res, { success: false, error: 'Report not found' }, 404);
        return json(res, report);
    }

    // Static files
    let fp = p === '/' ? '/index.php' : p;
    if (fp.endsWith('.php')) { const hv = fp.replace('.php','.html'); if (fs.existsSync(path.join(PUBLIC_DIR,hv))) fp = hv; }
    const full = path.join(PUBLIC_DIR, fp);
    if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        const ext = path.extname(full);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/html', 'Cache-Control': 'no-cache' });
        return fs.createReadStream(full).pipe(res);
    }
    const idx = path.join(PUBLIC_DIR, 'index.php');
    if (fs.existsSync(idx)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return fs.createReadStream(idx).pipe(res); }
    res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎯 Pinpointer v6.0 running on http://0.0.0.0:${PORT}`);
    console.log(`   AI: Google Gemini ${GEMINI_MODEL} (user-provided key)`);
    console.log(`   PSI: Enabled (${PSI_KEY ? 'key set' : 'no key'})`);
    console.log(`   Puppeteer: ${PUPPETEER_ENABLED ? 'ENABLED (visual analysis)' : 'DISABLED'}`);
    console.log(`   Skills: ${fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md')).length} loaded`);
    console.log(`   Architecture: Data-First + Puppeteer Vision + AI Insights + Severity-Weighted Scoring\n`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[Server] SIGTERM received, shutting down...');
    if (_browser) { try { await _browser.close(); } catch {} }
    server.close(() => process.exit(0));
});
process.on('SIGINT', async () => {
    console.log('[Server] SIGINT received, shutting down...');
    if (_browser) { try { await _browser.close(); } catch {} }
    server.close(() => process.exit(0));
});
