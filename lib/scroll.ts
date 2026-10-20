// Scroll the page to a progress value in [0..1] of its full scrollable height.
export function scrollToProgress(progress: number) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: maxScroll * progress, behavior: 'smooth' });
}
