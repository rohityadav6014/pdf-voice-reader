# PDF Voice Reader

Upload a PDF → listen to it in English or Hindi with a female voice, and download page-by-page notes.

**Live site:** https://rohityadav6014.github.io/pdf-voice-reader/

## Run

Double-click `index.html`, or serve the folder (recommended):

```
python -m http.server 8765
```

then open http://localhost:8765. Try it with `sample.pdf`.

**Best voices:** Microsoft Edge (natural voices *Neerja* for English, *Swara* for Hindi) or Google Chrome (*Google हिन्दी*).
If no Hindi voice shows up, add Hindi in Windows Settings → Time & language → Speech.

## Features

- **Double-click any word** in the PDF to start reading from that word (double-tap on phones).
- **Skip**: previous/next sentence, previous/next page, or drag the slider. Keys: `Space`, `←/→`, `Shift+←/→`.
- **English / हिन्दी audio**: Hindi is translated sentence by sentence (Google Translate) and read by a Hindi voice.
- **Notes per page**: title, definitions, key points, key terms, in English or Hindi.
  Download as Word (.doc), text (.txt) or PDF (print → Save as PDF), or per page.

## Notes

- Your PDF is processed in the browser. Only the text sent for Hindi translation leaves your device.
- Scanned PDFs (images with no selectable text) can't be read aloud.
- Audio plays live in the browser; the browser speech engine can't save it as an MP3 file.
