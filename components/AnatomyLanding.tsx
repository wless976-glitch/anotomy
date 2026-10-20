'use client';

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import SplitTitle from './SplitTitle';
import { AnatomyScene, type FrameState, type PickResult } from '@/lib/anatomy-scene';
import {
    atlasStats, brand, credit, headerCta, hero, layerLabels, loadingLabel, muscles, navItems, organs, skeleton
} from '@/lib/content';

const MODEL_URL = '/models/anatomy.glb';

// scroll windows in which each slide is shown
const SLIDE_RANGES: [number, number][] = [[-0.10, 0.12], [0.28, 0.40], [0.56, 0.68], [0.84, 1.05]];

// frame-rate independent version of a per-frame lerp factor tuned at 60fps
const damp = (factor: number, delta: number) => 1 - Math.pow(1 - factor, delta * 60);

function scrollToProgress(progress: number) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: maxScroll * progress, behavior: 'smooth' });
}

export default function AnatomyLanding() {
    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [loading, setLoading] = useState({ progress: 0, done: false, failed: false });

    useEffect(() => {
        const root = rootRef.current!;
        const canvas = canvasRef.current!;
        const cursorInner = root.querySelector<HTMLElement>('.cursor-inner')!;
        const cursorOuter = root.querySelector<HTMLElement>('.cursor-outer')!;
        const hoverLabel = root.querySelector<HTMLElement>('.hover-label')!;
        const slides = Array.from(root.querySelectorAll<HTMLElement>('.slide'));
        const atlasCard = root.querySelector<HTMLElement>('#slide-2-img')!;
        const dashes = Array.from(root.querySelectorAll<HTMLElement>('.story-dash'));
        const dots = Array.from(root.querySelectorAll<HTMLElement>('.grid-dot'));
        const finePointer = window.matchMedia('(pointer: fine)').matches;

        let scene: AnatomyScene | null = null;
        try {
            scene = new AnatomyScene(canvas, {
                modelUrl: MODEL_URL,
                onProgress: (progress) => setLoading((s) => ({ ...s, progress })),
                onLoaded: () => setLoading({ progress: 1, done: true, failed: false }),
                onError: (error) => {
                    console.error('Error loading anatomy model:', error);
                    setLoading((s) => ({ ...s, failed: true }));
                }
            });
        } catch (error) {
            // no WebGL: the editorial overlay still works on its own
            console.error('WebGL unavailable:', error);
            root.classList.add('no-webgl');
        }

        const resize = () => scene?.resize(window.innerWidth, window.innerHeight);
        resize();

        let currentScroll = 0;
        let mouseX = 0, mouseY = 0, targetMouseX = 0, targetMouseY = 0;
        let cursorX = window.innerWidth / 2, cursorY = window.innerHeight / 2;
        let outerCursorX = cursorX, outerCursorY = cursorY;
        let pointerInside = false, pointerMoved = false, lastPick = 0;
        let tap: { x: number; y: number; time: number } | null = null;
        let tapTimer = 0;

        const toNdc = (x: number, y: number) => [(x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1] as const;

        const showHit = (hit: PickResult | null) => {
            cursorOuter.classList.toggle('hovering', Boolean(hit));
            hoverLabel.classList.toggle('visible', Boolean(hit));
            if (hit) {
                hoverLabel.querySelector('.hover-layer')!.textContent = layerLabels[hit.layer];
                hoverLabel.querySelector('.hover-name')!.textContent = hit.name;
            }
        };

        const onPointerMove = (event: PointerEvent) => {
            cursorX = event.clientX;
            cursorY = event.clientY;
            cursorInner.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
            targetMouseX = (event.clientX / window.innerWidth) * 2 - 1;
            targetMouseY = (event.clientY / window.innerHeight) * 2 - 1;
            pointerInside = true;
            pointerMoved = true;
        };
        const onPointerLeave = () => { pointerInside = false; pointerMoved = true; };

        // touch has no hover: a quick tap names the structure under the finger for a moment
        const onPointerDown = (event: PointerEvent) => {
            tap = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY, time: performance.now() };
        };
        const onPointerCancel = () => { tap = null; };
        const onPointerUp = (event: PointerEvent) => {
            if (!tap || !scene) return;
            const isTap = Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 10 && performance.now() - tap.time < 400;
            tap = null;
            if (!isTap) return;
            cursorX = outerCursorX = event.clientX;
            cursorY = outerCursorY = event.clientY;
            showHit(scene.pick(...toNdc(event.clientX, event.clientY)));
            window.clearTimeout(tapTimer);
            tapTimer = window.setTimeout(() => showHit(null), 2500);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        document.documentElement.addEventListener('pointerleave', onPointerLeave);
        window.addEventListener('resize', resize);

        const updateSlides = (scroll: number) => {
            dashes.forEach((dash, i) => {
                const progress = Math.max(0, Math.min(1, (scroll - i * 0.25) / 0.25));
                (dash.firstElementChild as HTMLElement).style.height = `${progress * 100}%`;
                dash.classList.toggle('current', scroll >= i * 0.25 - 0.02 && scroll < (i + 1) * 0.25 - 0.02);
            });
            slides.forEach((slide, i) => {
                const [start, end] = SLIDE_RANGES[i];
                const active = scroll >= start && scroll <= end;
                slide.classList.toggle('active', active);
                if (i === 1) atlasCard.classList.toggle('active', active);
            });
        };

        const updateGridDots = (scroll: number) => {
            dots.forEach((dot, i) => {
                const startY = (i * 17) % 80 + 10;
                let speed = 90 + (i * 55) % 180;
                if (i % 2 === 0) speed = -speed;
                let y = startY + scroll * speed;
                y = ((y % 100) + 100) % 100;
                dot.style.top = `${y}%`;
            });
        };

        // name the structure under the cursor, a few times a second at most
        const updateHover = (now: number) => {
            if (!scene || !finePointer || !pointerMoved || now - lastPick < 90) return;
            pointerMoved = false;
            lastPick = now;
            showHit(pointerInside ? scene.pick(...toNdc(cursorX, cursorY)) : null);
        };

        let frame = 0;
        let last = performance.now();
        let elapsed = 0;
        const animate = (now: number) => {
            frame = requestAnimationFrame(animate);
            const delta = Math.min(0.1, (now - last) / 1000);
            last = now;
            elapsed += delta;

            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            const targetScroll = maxScroll > 0 ? window.scrollY / maxScroll : 0;
            currentScroll += (targetScroll - currentScroll) * damp(0.025, delta);

            mouseX += (targetMouseX - mouseX) * damp(0.05, delta);
            mouseY += (targetMouseY - mouseY) * damp(0.05, delta);

            outerCursorX += (cursorX - outerCursorX) * damp(0.2, delta);
            outerCursorY += (cursorY - outerCursorY) * damp(0.2, delta);
            cursorOuter.style.transform = `translate3d(${outerCursorX}px, ${outerCursorY}px, 0) translate(-50%, -50%)`;
            // the label sits right of the cursor, or left of it near the right edge
            hoverLabel.style.transform = outerCursorX > window.innerWidth * 0.6
                ? `translate3d(${outerCursorX - 30}px, ${outerCursorY - 10}px, 0) translateX(-100%)`
                : `translate3d(${outerCursorX + 30}px, ${outerCursorY - 10}px, 0)`;

            const state: FrameState = { scroll: currentScroll, targetScroll, mouseX, mouseY, delta, elapsed };
            scene?.update(state);
            updateSlides(currentScroll);
            updateGridDots(currentScroll);
            updateHover(now);
        };
        frame = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(tapTimer);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            document.documentElement.removeEventListener('pointerleave', onPointerLeave);
            window.removeEventListener('resize', resize);
            scene?.dispose();
        };
    }, []);

    const goTo = (progress: number) => (event: MouseEvent) => {
        event.preventDefault();
        scrollToProgress(progress);
    };

    return (
        <div ref={rootRef}>
            <div className="cursor-inner" aria-hidden="true" />
            <div className="cursor-outer" aria-hidden="true" />
            <div className="hover-label" aria-hidden="true">
                <span className="hover-layer" />
                <span className="hover-name" />
            </div>

            <div className="cinematic-container">
                <header className="main-header">
                    <div className="brand">{brand}</div>
                    <nav className="header-nav" aria-label="Давхаргууд">
                        {navItems.map((item, i) => (
                            <span key={item.href} className="nav-item">
                                {i > 0 && <span className="nav-dot" />}
                                <a href={item.href} className="nav-link" onClick={goTo(item.scroll)}>{item.label}</a>
                            </span>
                        ))}
                    </nav>
                    <div className="header-actions">
                        <a href={headerCta.href} className="contact-btn" onClick={goTo(0.94)}>
                            {headerCta.label} <span className="btn-circle" />
                        </a>
                    </div>
                </header>

                <section className="slide" id="slide-1">
                    <SplitTitle as="h1" lines={hero.title} />
                    <div className="desc-row">
                        <p className="slide-desc col-1">{hero.columns[0]}</p>
                        <p className="slide-desc col-2">{hero.columns[1]}</p>
                    </div>
                </section>
                <section className="slide" id="slide-2">
                    <SplitTitle lines={muscles.title} />
                    <p className="slide-desc">{muscles.text}</p>
                </section>
                <section className="slide" id="slide-3">
                    <SplitTitle lines={skeleton.title} />
                    <p className="slide-desc">{skeleton.text}</p>
                </section>
                <section className="slide" id="slide-4">
                    <SplitTitle lines={organs.title} />
                    <p className="slide-desc">{organs.text}</p>
                    <a href="#" className="contact-btn slide-cta">{organs.cta} <span className="btn-circle" /></a>
                </section>

                <p className="credit">
                    {credit.prefix} <a href={credit.source.href} target="_blank" rel="noreferrer">{credit.source.label}</a>
                    {' · '}
                    <a href={credit.license.href} target="_blank" rel="noreferrer">{credit.license.label}</a>
                </p>
            </div>

            <aside className="slide-image-mask atlas-card" id="slide-2-img" aria-label={atlasStats.kicker}>
                <div className="atlas-card-inner">
                    <p className="atlas-kicker">{atlasStats.kicker}</p>
                    <dl>
                        {atlasStats.items.map((item) => (
                            <div key={item.label}>
                                <dt>{item.value}</dt>
                                <dd>{item.label}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </aside>

            <div className="grid-horizontal-line">
                <div
                    className={`load-line${loading.done || loading.failed ? ' done' : ''}`}
                    style={{ transform: `scaleX(${loading.progress})` }}
                />
            </div>
            <p className={`load-label${loading.done || loading.failed ? ' done' : ''}`} role="status">
                {loading.failed ? '' : `${loadingLabel} · ${Math.round(loading.progress * 100)}%`}
            </p>

            <div className="grid-lines" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="grid-line"><div className="grid-dot top" /><div className="grid-dot bottom" /></div>
                ))}
                <div className="grid-line story-progress-container">
                    <div className="grid-dot top" />
                    <div className="grid-dot bottom" />
                    <div className="story-dashes">
                        {navItems.map((item) => (
                            <div key={item.href} className="story-dash">
                                <div className="story-dash-fill" />
                                <span className="story-label">{item.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <canvas ref={canvasRef} id="webgl" />
        </div>
    );
}
