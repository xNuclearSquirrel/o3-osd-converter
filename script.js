document.getElementById("convertButton").addEventListener("click", () => {
    const inputFile = document.getElementById("inputFile").files[0];
    const outputFileName =
      document.getElementById("outputFileName").value ||
      `${inputFile.name}_v2.osd`;
    const fpsValue = parseFloat(document.getElementById("fpsInput").value);
  
    // Validate required inputs
    if (!inputFile) {
      alert("Please provide an input file.");
      return;
    }
    if (isNaN(fpsValue) || fpsValue <= 0) {
      alert("Please provide a valid FPS value.");
      return;
    }
  
    const reader = new FileReader();
    reader.onload = function (event) {
      const originalData = new Uint8Array(event.target.result);
  
      // Ensure the file has at least 40 bytes for an O3 header
      if (originalData.length < 40) {
        alert("File too small to be a valid O3 variant file.");
        return;
      }
  
      // Read the first 40 bytes as header
      const headerBytes = originalData.slice(0, 40);
      const magicString = new TextDecoder().decode(headerBytes.slice(0, 7));
      // If the magic string equals "MSPOSD\0", then it's an older format (which we do not support here)
      if (magicString === "MSPOSD\u0000") {
        alert("The file appears to be in an older format, not the O3 variant.");
        return;
      }
  
      // Determine grid dimensions from header:
      // The signature is stored at bytes 36-40.
      const signature = new TextDecoder().decode(headerBytes.slice(36, 40));
      let gridWidth, gridHeight;
      if (signature === "DJO3") {
        gridWidth = 53;
        gridHeight = 20;
      } else {
        // Dimensions stored at offsets 0x24 and 0x26 (i.e. bytes 36 and 38)
        gridWidth = headerBytes[0x24];
        gridHeight = headerBytes[0x26];
      }
      const frameCellCount = gridWidth * gridHeight;
  
      // Start parsing frames from offset 40
      let offset = 40;
      const frames = [];
  
      while (offset + 4 <= originalData.length) {
        // Read 4 bytes for delta time (unsigned int, little-endian)
        const deltaTime = new DataView(originalData.buffer, offset, 4).getUint32(0, true);
        offset += 4;
        const timestamp = deltaTime / 1000; // Convert ms to seconds
  
        // Calculate expected frame data size (each cell: 2 bytes)
        const expectedFrameBytes = frameCellCount * 2;
        if (offset + expectedFrameBytes > originalData.length) break;
  
        // Read the frame content bytes
        const frameContentBytes = originalData.slice(offset, offset + expectedFrameBytes);
        offset += expectedFrameBytes;
  
        // Convert frame content bytes into an array of 16-bit values
        const frameContent = [];
        for (let i = 0; i < frameContentBytes.length; i += 2) {
          const val = new DataView(frameContentBytes.buffer, frameContentBytes.byteOffset + i, 2).getUint16(0, true);
          frameContent.push(val);
        }
  
        // Reorder (transpose) frame content as expected in version 2 format.
        // The new order is: for each row j (0 to gridHeight-1) and for each column i (0 to gridWidth-1),
        // the value comes from original index = (j * gridWidth + i) and is placed at index = (i * gridHeight + j).
        const reorderedContent = new Uint16Array(frameContent.length);
        for (let j = 0; j < gridHeight; j++) {
          for (let i = 0; i < gridWidth; i++) {
            const originalIndex = j * gridWidth + i;
            const newIndex = i * gridHeight + j;
            reorderedContent[newIndex] = frameContent[originalIndex];
          }
        }
  
        // Calculate the frame number based on timestamp and provided FPS.
        const frameNumber = Math.floor(timestamp * fpsValue);
        frames.push({
          frameNumber,
          frameSize: frameCellCount,
          content: reorderedContent,
        });
      }
  
      // Build the output header for a version 2 file (20 bytes)
      const outputHeader = new Uint8Array(20);
      let headerOffset = 0;
      // Magic string: "MSPOSD" followed by a null terminator (7 bytes total)
      const magic = new TextEncoder().encode("MSPOSD\u0000");
      outputHeader.set(magic, headerOffset);
      headerOffset += 7;
      // Version number (2 bytes, little-endian). Here, version = 2.
      new DataView(outputHeader.buffer).setUint16(headerOffset, 2, true);
      headerOffset += 2;
      // charWidth and charHeight (1 byte each) from the grid dimensions
      outputHeader[headerOffset++] = gridWidth;
      outputHeader[headerOffset++] = gridHeight;
      // Determine fontWidth and fontHeight based on grid dimensions mapping:
      let fontWidth = 0,
        fontHeight = 0;
      if (gridWidth === 60 && gridHeight === 22) {
        fontWidth = 36;
        fontHeight = 24;
      } else if (gridWidth === 53 && gridHeight === 20) {
        fontWidth = 39;
        fontHeight = 26;
      } else if (gridWidth === 30 && gridHeight === 15) {
        fontWidth = 54;
        fontHeight = 36;
      }
      outputHeader[headerOffset++] = fontWidth;
      outputHeader[headerOffset++] = fontHeight;
      // xOffset (2 bytes) and yOffset (2 bytes) – set both to 0
      new DataView(outputHeader.buffer).setUint16(headerOffset, 0, true);
      headerOffset += 2;
      new DataView(outputHeader.buffer).setUint16(headerOffset, 0, true);
      headerOffset += 2;
      // fontVariant (5 bytes) – leave as zeros (empty)
      // (No need to set explicitly since the Uint8Array is zero-filled by default)
  
      // Build the frame data chunks.
      // Each frame will have an 8-byte header: 4 bytes for frameNumber and 4 bytes for frameSize,
      // followed by the frame content (each cell as 2 bytes, little-endian).
      const frameChunks = [];
      for (const frame of frames) {
        // Create 8-byte frame header.
        const frameHeader = new Uint8Array(8);
        new DataView(frameHeader.buffer).setUint32(0, frame.frameNumber, true);
        new DataView(frameHeader.buffer).setUint32(4, frame.frameSize, true);
  
        // Create frame content bytes.
        const frameContentBytes = new Uint8Array(frame.frameSize * 2);
        for (let i = 0; i < frame.content.length; i++) {
          new DataView(frameContentBytes.buffer).setUint16(i * 2, frame.content[i], true);
        }
  
        // Concatenate the frame header and frame content.
        const frameChunk = new Uint8Array(frameHeader.length + frameContentBytes.length);
        frameChunk.set(frameHeader, 0);
        frameChunk.set(frameContentBytes, frameHeader.length);
        frameChunks.push(frameChunk);
      }
  
      // Calculate total output size: header plus all frame chunks.
      const totalSize =
        outputHeader.length +
        frameChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const outputData = new Uint8Array(totalSize);
      let outputOffset = 0;
      outputData.set(outputHeader, outputOffset);
      outputOffset += outputHeader.length;
      for (const chunk of frameChunks) {
        outputData.set(chunk, outputOffset);
        outputOffset += chunk.length;
      }
  
      // Create a Blob and trigger a download.
      const blob = new Blob([outputData], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = outputFileName;
      a.click();
    };
  
    reader.readAsArrayBuffer(inputFile);
  });
  