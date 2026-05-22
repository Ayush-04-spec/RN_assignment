const fs = require('fs');

const keepStrings = [
    "CRITICAL",
    "prevent 12MP overload",
    "manageable frame sizes",
    "MUST match the camera format",
    "portrait, dimensions may be swapped",
    "prevent buffer overflow",
    "prevents CameraX buffer overflow",
    "prevent hang",
    "pointing at dark surface",
    "Maximum physical size check",
    "Marker will never take up",
    "allow perspective skewing",
    "zero geometric skew",
    "respect system for light taps",
    "Override system for success feedback",
    "notificationSuccess for a more distinct, punchy pattern",
    "stop hunting",
    "throttle",
    "bail-out",
    "STRICT:",
    "relax"
];

function shouldKeepComment(text) {
    if (text.includes("eslint-disable") || text.includes("@ts-ignore")) return true;
    for (let s of keepStrings) {
        if (text.toLowerCase().includes(s.toLowerCase())) return true;
    }
    return false;
}

function processFile(file) {
    fs.copyFileSync(file, file + '.bak');
    let content = fs.readFileSync(file, 'utf-8');
    let lines = content.split('\n');
    let out = [];
    let inMulti = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].replace(/\r$/, '');
        let t = line.trim();

        if (t.startsWith('/*') && !t.endsWith('*/') && !t.includes('eslint')) {
            inMulti = true;
            if (t.startsWith('/**') && file.includes('imageProcessorPerspective')) {
                if (i === 11) {
                    out.push('/** Extracts a marker from a high-resolution photo using 4-point perspective transform. */');
                }
                if (i === 64) {
                    out.push('/** Fallback: If perspective transform fails, use the old bounding box method. */');
                }
            }
            if (t.startsWith('/**') && file.includes('PerspectiveTransformModule.java')) {
                if (i === 27) {
                    out.push('/** Native module for performing 4-point perspective transform using OpenCV. */');
                }
                if (i === 57) {
                    out.push('    /** Performs 4-point perspective transform on an image with rotation correction. */');
                }
                if (i === 248) {
                    out.push('    /** Validates that a point is within image bounds. */');
                }
            }
            continue;
        }
        if (inMulti) {
            if (t.endsWith('*/')) inMulti = false;
            continue;
        }
        
        if (t.startsWith('/*') && t.endsWith('*/') && !t.includes('eslint')) {
            continue;
        }

        if (t.startsWith('{/*') && t.endsWith('*/}')) {
            continue;
        }

        let commentMatch = line.match(/^(\s*)\/\/(.*)$/);
        if (commentMatch) {
            let space = commentMatch[1];
            let cText = commentMatch[2];
            if (/[─═━★•▸]/.test(cText) || cText.includes('---') || cText.includes('===') || cText.match(/[\u{1F300}-\u{1F9FF}]/u) || cText.includes('Layer')) {
                continue;
            }
            if (shouldKeepComment(cText)) {
                out.push(line);
            }
            continue;
        }

        let inlineMatch = line.match(/^(.*?[^:\s])\s*\/\/(.*)$/);
        if (inlineMatch && !line.includes('://')) {
            let before = inlineMatch[1];
            let cText = inlineMatch[2];
            if (shouldKeepComment(cText)) {
                out.push(line);
            } else {
                out.push(before);
            }
            continue;
        }

        out.push(line);
    }

    let finalOut = [];
    let consecutiveBlanks = 0;
    for (let i = 0; i < out.length; i++) {
        let line = out[i];
        if (line.trim() === '') {
            consecutiveBlanks++;
            if (consecutiveBlanks <= 1) {
                finalOut.push(line);
            }
        } else {
            consecutiveBlanks = 0;
            finalOut.push(line);
        }
    }

    while(finalOut.length > 0 && finalOut[0].trim() === '') {
        finalOut.shift();
    }

    fs.writeFileSync(file, finalOut.join('\n'), 'utf-8');
}

processFile('src/screens/CameraScreen.tsx');
processFile('src/screens/ResultsScreen.tsx');
processFile('src/utils/imageProcessorPerspective.ts');
processFile('android/app/src/main/java/com/markerscanner/PerspectiveTransformModule.java');
