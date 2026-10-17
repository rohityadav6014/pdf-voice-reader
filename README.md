# Sunotes

**Sunotes** ("suno" = listen, + notes): upload a PDF or Word (.docx) file → listen to it in English or Hindi with a female voice, and download page-by-page notes.

**Live site:** https://rohityadav6014.github.io/pdf-voice-reader/

## Run

Double-click `index.html`, or serve the folder (recommended):

```
python -m http.server 8765
```

then open http://localhost:8765. Try it with `sample.pdf` or `sample.docx`.

**Best voices:** Microsoft Edge (natural voices *Neerja* for English, *Swara* for Hindi) or Google Chrome (*Google हिन्दी*).
If no Hindi voice shows up, add Hindi in Windows Settings → Time & language → Speech.

## Features

- **PDF and Word**: PDFs are shown page by page; Word (.docx) files are shown as page-sized sections in a large,
  easy-to-read layout. Old .doc files need to be saved as .docx first.
- **Double-click any word** to start reading from that word (double-tap on phones).
- **Hide panel** gives the document the full width; zoom with − / +.
- **Skip**: previous/next sentence, previous/next page, or drag the slider. Keys: `Space`, `←/→`, `Shift+←/→`.
- **English / हिन्दी audio**: Hindi is translated sentence by sentence (Google Translate) and read by a Hindi voice.
- **Background music** at 40% under the reading voice (adjustable). It starts and pauses with the reading and loops.
  By default it plays the tracks in the `music/` folder: name them `music1.mp3`, `music2.mp3`, … (or list any
  file names in `music/playlist.json` as `["song.mp3", …]`). You can paste a YouTube link or upload an audio file
  instead; "Use default music" goes back to the folder. If the folder is empty, a YouTube study-music video is embedded.
- **Notes per page**: title, definitions and key points, in English or Hindi.
  Download as Word (.doc), text (.txt) or PDF (print → Save as PDF), or per page.

## Notes

- Your file is processed in the browser. Only the text sent for Hindi translation leaves your device.
- Scanned PDFs (images with no selectable text) can't be read aloud.
- Audio plays live in the browser; the browser speech engine can't save it as an MP3 file.
