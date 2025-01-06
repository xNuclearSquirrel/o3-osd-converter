document.getElementById("convertButton").addEventListener("click", () => {
    const inputFile = document.getElementById("inputFile").files[0];
    const outputFileName = document.getElementById("outputFileName").value || `${inputFile.name}_walksnail.osd`;
    const createWalksnail = document.getElementById("createWalksnail").checked;

    if (!inputFile || !createWalksnail) {
        alert("Please provide an input file and select the Walksnail option.");
        return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
        const originalData = new Uint8Array(event.target.result);

        // Step 1: Create the Walksnail header
        const walksnailHeader = new Uint8Array(40);
        const firmware = new TextEncoder().encode("BTFL_DJIO3");
        walksnailHeader.set(firmware, 0);
        walksnailHeader.set([0xC9, 0x00, 0x00, 0x00, 0x35, 0x00, 0x14, 0x00], 32);

        const outputChunks = [];
        outputChunks.push(walksnailHeader);

        // Step 2: Parse the header and frames (Version 3 logic)
        let offset = 0;
        const magic = new TextDecoder().decode(originalData.subarray(offset, offset + 7));
        offset += 7;
        const version = new DataView(originalData.buffer).getUint16(offset, true);
        offset += 2;
        const charWidth = originalData[offset++];
        const charHeight = originalData[offset++];
        offset += 11; // Skip remaining config fields

        const gridWidth = 53;
        const gridHeight = 20;
        let frameCount = 0;

        // Step 3: Process frames
        while (offset < originalData.length) {
            console.log(`Processing frame at offset: ${offset}`);

            // Read timestamp (8 bytes) and frame size (4 bytes)
            const timestamp = new DataView(originalData.buffer).getFloat64(offset, true);
            offset += 8;

            const frameSize = new DataView(originalData.buffer).getUint32(offset, true);
            offset += 4;

            console.log(`Timestamp: ${timestamp}, Frame Size: ${frameSize}`);

            // Read the frame content
            const frameContent = originalData.subarray(offset, offset + frameSize);
            offset += frameSize;

            console.log(`Frame content read: ${frameContent.length} bytes`);

            // Create a Walksnail frame
            const walksnailFrame = new Uint8Array(2124);
            const timestampMillis = Math.floor(timestamp * 1000);
            walksnailFrame.set(new Uint8Array(new Uint32Array([timestampMillis]).buffer), 0);

            // Map original frame grid to Walksnail grid
            for (let y = 0; y < gridHeight; y++) {
                for (let x = 0; x < gridWidth; x++) {
                    const originalIndex = y * charWidth + x;
                    const walksnailIndex = 4 + (y * gridWidth + x) * 2;

                    if (originalIndex < frameContent.length) {
                        const byte = frameContent[originalIndex];
                        if (byte === 0x00) {
                            walksnailFrame[walksnailIndex] = 0x20;
                            walksnailFrame[walksnailIndex + 1] = 0x00;
                        } else {
                            walksnailFrame[walksnailIndex] = byte;
                            walksnailFrame[walksnailIndex + 1] = 0x00;
                        }
                    } else {
                        walksnailFrame[walksnailIndex] = 0x20;
                        walksnailFrame[walksnailIndex + 1] = 0x00;
                    }
                }
            }

            // Add the frame to the output chunks
            outputChunks.push(walksnailFrame);
            frameCount++;
            console.log(`Frame ${frameCount} processed and added.`);
        }

        // Step 4: Flatten and write the output data
        console.log(`Total frames processed: ${frameCount}`);
        const totalSize = outputChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const outputData = new Uint8Array(totalSize);
        let offsetOutput = 0;
        for (const chunk of outputChunks) {
            outputData.set(chunk, offsetOutput);
            offsetOutput += chunk.length;
        }

        console.log(`Final output size: ${totalSize} bytes`);
        const blob = new Blob([outputData], { type: "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = outputFileName;
        a.click();
    };

    reader.readAsArrayBuffer(inputFile);
});
