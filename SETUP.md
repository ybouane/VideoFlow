# VideoFlow — Build Instructions

## Overview

Create **VideoFlow**, an open-source library that can:

1. **Render videos from a JSON object**
	Work both:
	- **client-side in the browser**
	- **through an API**

The core goal is to define videos as structured JSON and render them into final video output.

---

## Core Concept

A video is represented by a **JSON object** describing its layers and properties.

Each layer can represent a different media type, such as:

- **Text**
- **Image**
- **Video**
- **Audio**
- ...

The system must be able to take this JSON object and generate a final rendered video from it.

---

## Rendering Requirements

VideoFlow must support rendering in two environments:

### 1. Browser-side rendering
Render videos fully **in-browser / client-side**.

### 2. Server-side rendering
Render the same JSON-defined videos on Node.js, allowing for **API-based video generation**.

For that, you need to leverage Playwright to run a headless browser environment on the server, enabling the same rendering logic to be executed in both environments. The playwright setup will be rendering each frame in a headless browser, then capturing the rendered output to compile into a video via ffmpeg.


Both approaches should rely on the same browser-based rendering model and compatible data structure.

---

## Technical Direction

Use the **same technology, techniques, and overall setup as Scrptly**.

I will provide you with an example project called **Scrptly** that you can thoroughly inspect and use as a reference for implementation details and architecture.

The source for Scrptly is split into:
1. The remote git repository: https://github.com/Scrptly/scrptly
	This repository contains the definition for the layers and the flow-to-json system. This system allows to create videos programatically by calling functions which then generates a JSON object that can be rendered into a video. This repository doesn't contain the rendering logic, only the JSON schema and the video flow system.
2. The local directory: /var/projects/scrptly/
	This directory contains the rendering logic, which is based on the JSON schema defined in the remote repository. This rendering logic is what you should use as a reference for implementing the rendering system for VideoFlow. It includes both the browser-based rendering and the server-side rendering using Playwright. Explore it thoroughly to reimplement it as a standalone library for VideoFlow.



Your task is to:

- explore how Scrptly was built
- reuse the same core technical approach
- adapt that approach to fit the specific VideoFlow requirements described here

Do not hesitate to heavily reuse the same code and technical approach as Scrptly, but adapt it to fit the specific requirements and design of VideoFlow.


---

## Rendering Approach

Just like Scrptly, VideoFlow must generate video frames by:
1. Generate an SVG image (leveraging `foreignObject`) for each frame based on the JSON definition
2. Draw that SVG onto an off-screen canvas
3. Capture the canvas output for video compilation
4. Encoding the frames into a video file using modern Web APIs (like MediaBunny) OR transfer the frames to a server-side environment for ffmpeg processing
5. Support audio integration into the final video output

### Important detail

The SVG must will use **`foreignObject`**.

This is a central part of the project.

The purpose is to allow rich layout/styling capabilities by generating frames through SVG content that includes foreign objects, then drawing those frames onto canvas.

---

## Audio Support

Audio must be fully supported.

This includes supporting audio as part of the rendered video pipeline, not just silent video export.

---

## Data Model

The VideoFlow JSON format will be **different from Scrptly**.

Although Scrptly should be used as the technical reference, the **JSON schema and object definition must be adapted** to match the VideoFlow-specific design that I will define separately.

So the implementation should:

- keep Scrptly’s technical foundation
- but **not copy Scrptly’s JSON structure directly**
- instead, use the new VideoFlow JSON format that will be specified

---

## Deliverable

Build a **full library** that can:

- render videos from JSON
- support multiple layer types
- support browser-side rendering
- support API-based rendering
- generate frames using SVG + `foreignObject` + off-screen canvas
- compile frames into video using MediaBunny
- support audio
- Make the library support Typescript for type safety and better developer experience.
- Annotate the code with detailed comments that will serve to generate the documentation later on. The comments should explain the purpose and functionality of each function, class, and important code block, providing insights into the implementation details and design decisions.

---

## Reference

Use **Scrptly** as the implementation reference for:

- architecture
- rendering strategy
- setup
- technology choices
- frame generation workflow
- video compilation workflow

But adapt everything as needed for **VideoFlow** and the new JSON model.

---

## Video JSON Model
{
	name: "My Video", // Name of the video
	duration: 10, // Duration in seconds, this will automatically be calculated based on the layers and their timings
	width: 1920, // Width of the video
	height: 1080, // Height of the video
	fps: 30, // Frames per second
	layers: [ // Array of video objects
		{
			id: "", // uuid v4 identifier for the layer
			type: "text", // Type of layer (text, image, video, audio, etc.)
			settings: {
				enabled: true, // Whether the layer is enabled or not
				startTime: 0, // Time in seconds when the layer should appear
				duration: 5, // Duration in seconds for how long the layer should be visible
				...
			},
			properties: { // Properties are attributes that can change over time (some are interpolable, some are not, depending on the type)
				"text": "Hello, World!", // The text content for a text layer
				...
			},
			animations: [ // Array of animations for this layer
				{
					property: "opacity", // The property to animate
					keyframes: [ // Keyframes for the animation
						{ time: 0, value: 0 }, // At time 0s, opacity is 0
						{ time: 1, value: 1 }, // At time 1s, opacity is 1
						...
					],
					easing: "easeInOut", // Easing function for the animation
				},
				...
			]
		}
	]
}


## Differences from Scrptly
- Do not import AI stuff / integrations
	- The video / image / audio layers should only support URL & file inputs, not AI-generated content
- You won't have access to any DB or storage system, so all media assets must be provided as URLs or file paths, and the system should be designed to handle that. The Asset collection is not available, so you won't have access to its metadata. Instead you should extract the metadata directly from the media files or URLs when needed. (this is done differently in browser vs server environments)
- Do not import the React-based video editor
- Do not import:
	- The TTS layer
	- The Chart layer
	- Any "Folder" feature / layer
- The captions layer should not accept an audio as an input, instead it should have a "captions" setting like: [ { caption, startTime, endTime } ]
- No AI Agent feature
- Times are handled differently:
	- Internally, times should be converted to frame numbers for easier processing during rendering. this should be done using getters such as layer.startFrame, layer.endFrame, etc. which will convert the time-based settings into frame numbers based on the video's fps.
	- The API (including the JSON model) should accept flexible time formats for layer settings and animations, such as:
		- number time -> time in seconds
		- string time without units -> time in seconds
		- string time with units -> duration format like "5s" -> 5 seconds, "2m" -> 2 minutes, "1h" -> 1 hour, "120f" -> 120 frames, etc.

Instead of calling an external API endpoint for doing the rendering it should do the rendering directly in the browser for the client-side version, and using Playwright for the server-side version.


The library should have the following folders:
/dist
/src
	/core // core logic, data structures, JSON schema, etc.
	/renderer-browser // rendering logic, including browser-based rendering
	/renderer-server // server-side rendering logic using Playwright

The src folders will be used for importing the packages like:
```npm install @videoflow/core @videoflow/renderer-browser @videoflow/renderer-server```


```javascript
import VideoFlow from '@videoflow/core';
import VideoRenderer from '@videoflow/renderer-browser'; // or '@videoflow/renderer-server' for the server-side version

const $ = new VideoFlow({
	name: "My Video",
	width: 1920,
	height: 1080,
	fps: 30,
	verbose: true, // whether to log the rendering process in detail (using listr2)
});

const bg = $.addImage(
	{ fit: 'cover' },             // ▶ layer properties
	{ 
		source: 'https://example.com/background.jpg',
	}                              // ▶ layer settings
);

bg.animate(
	{ filterBlur: 0 },
	{ filterBlur: 10 },
	{ duration: '5s', wait: false }
);

const text = $.addText(
	{ text: 'Hello, World!', fontSize: 1.5, color: '#ffffff' },
	{ fontFamily: 'Noto Sans' }    // uses default easing
);
text.animate(
	{ opacity: 0 },
	{ opacity: 1, scale: 1.2 },
	{ duration: '3s', wait: false }             // don't wait until it's done
);

$.wait('1s');



const videoBuffer = await VideoRenderer.render(await $.compile(), { // compile generates the converts the video flow into the video JSON format, then the render function takes that JSON and renders it into a video output based on the provided options
	// rendering options, e.g.
	outputType: 'buffer', // or 'file' + opt.output='/path/to/output.mp4' for saving to disk, etc.
});

// Note that compile will need to resolve the content in the video (like fetching images, extracting audio metadata, etc.) before generating the final JSON object that will be used for rendering. This is because the timings and other settings might depend on the metadata of the media assets, so the compile function should handle that resolution process to ensure the final JSON is complete and ready for rendering.

// OR 

const videoBuffer = await $.renderVideo({ // auto chooses the right renderer based on the environment
	// rendering options, e.g.
	outputType: 'buffer', // or 'file' for saving to disk, etc.
});


```

You should also provide a way to stop the rendering process in case it's taking too long or the user wants to cancel it. This can be done through an AbortController or a similar mechanism that allows the rendering function to be aborted (can be passed in the rendering options).

