/**
 * RuntimeCaptionsLayer — runtime class for time-coded captions.
 *
 * Overrides getPropertiesAtFrame to inject the active caption text,
 * and handles the `text` non-CSS property.
 */

import type { PropertyDefinition } from '@videoflow/core/types';
import RuntimeTextualLayer from './RuntimeTextualLayer.js';

export default class RuntimeCaptionsLayer extends RuntimeTextualLayer {
	getPropertiesAtFrame(frame: number): Record<string, any> {
		const props = super.getPropertiesAtFrame(frame);

		// Overlay the active caption text from the captions setting
		if (this.json.settings.captions) {
			const timeSec = frame / this.fps;
			const caption = (this.json.settings.captions as any[]).find(
				(c: any) => c.startTime <= timeSec && c.endTime >= timeSec
			);
			props['text'] = caption?.caption ?? '';
		}

		return props;
	}

	async applyProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		if (prop === 'text') {
			if (this.$element) this.$element.textContent = value;
		} else {
			await super.applyProperty(prop, value, definition);
		}
	}
}
