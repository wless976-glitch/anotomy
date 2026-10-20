import { Fragment } from 'react';

// A slide title split into per-letter spans that blur-rise in with a 35ms stagger.
// Words stay unbreakable so a line never wraps mid-word.
export default function SplitTitle({ lines, as: Tag = 'h2' }: { lines: string[]; as?: 'h1' | 'h2' }) {
    let index = 0;
    return (
        <Tag className="slide-title" aria-label={lines.join(' ')}>
            {lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                    {lineIndex > 0 && <br />}
                    {line.split(' ').map((word, wordIndex) => (
                        <Fragment key={wordIndex}>
                            {wordIndex > 0 && ' '}
                            <span className="word" aria-hidden="true">
                                {Array.from(word).map((char, charIndex) => (
                                    <span key={charIndex} className="char" style={{ transitionDelay: `${index++ * 0.035}s` }}>
                                        {char}
                                    </span>
                                ))}
                            </span>
                        </Fragment>
                    ))}
                </Fragment>
            ))}
        </Tag>
    );
}
