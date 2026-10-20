'use client';

import { Fragment, useState } from 'react';
import type { MouseEvent } from 'react';
import { brand, header, navItems } from '@/lib/content';
import { scrollToProgress } from '@/lib/scroll';

function ChevronIcon() {
    return (
        <svg className="nav-chevron" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <path d="M1.5 3 4 5.5 6.5 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M5 1v5.5M2.5 4.5 5 7l2.5-2.5M1.5 9h7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Overlay header in the page's own style: brand left, dotted menu with a "models" dropdown,
// white pill on the right. On narrow screens the menu folds into a panel behind the burger.
export default function SiteHeader() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [modelsOpen, setModelsOpen] = useState(false);

    const go = (scroll?: number) => (event: MouseEvent) => {
        setMenuOpen(false);
        setModelsOpen(false);
        if (scroll === undefined) return;
        event.preventDefault();
        scrollToProgress(scroll);
    };

    return (
        <header className={`site-header${menuOpen ? ' menu-open' : ''}`}>
            <a href="#slide-1" className="brand" onClick={go(0)}>{brand}</a>

            <nav id="site-nav" className="site-nav" aria-label="Үндсэн цэс">
                <div
                    className={`nav-dropdown${modelsOpen ? ' open' : ''}`}
                    // touch fires a synthetic leave right after the tap, so only a real mouse closes it
                    onPointerLeave={(event) => event.pointerType === 'mouse' && setModelsOpen(false)}
                >
                    <button
                        type="button"
                        className="nav-link"
                        aria-expanded={modelsOpen}
                        aria-controls="models-menu"
                        onClick={() => setModelsOpen((open) => !open)}
                    >
                        {header.modelsLabel}
                        <ChevronIcon />
                    </button>
                    <div id="models-menu" className="nav-menu">
                        {navItems.map((item) => (
                            <a key={item.href} href={item.href} onClick={go(item.scroll)}>{item.menuLabel}</a>
                        ))}
                    </div>
                </div>
                {header.links.map((link) => (
                    <Fragment key={link.label}>
                        <span className="nav-dot" aria-hidden="true" />
                        <a href={link.href} className="nav-link" onClick={go(link.scroll)}>{link.label}</a>
                    </Fragment>
                ))}
            </nav>

            <div className="header-actions">
                <a href={header.download.href} className="contact-btn" onClick={go(header.download.scroll)}>
                    {header.download.label}
                    <DownloadIcon />
                </a>
                <button
                    type="button"
                    className="menu-toggle"
                    aria-expanded={menuOpen}
                    aria-controls="site-nav"
                    aria-label={header.menuLabel}
                    onClick={() => setMenuOpen((open) => !open)}
                >
                    <span />
                    <span />
                </button>
            </div>
        </header>
    );
}
