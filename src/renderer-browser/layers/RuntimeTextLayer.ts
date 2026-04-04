/**
 * RuntimeTextLayer — runtime class for static text layers.
 *
 * Handles the `text` non-CSS property by setting element text content.
 */

import type { PropertyDefinition } from '@videoflow/core/types';
import RuntimeTextualLayer from './RuntimeTextualLayer.js';

export default class RuntimeTextLayer extends RuntimeTextualLayer {
	async applyProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		if (prop === 'text') {
			if (this.$element) this.$element.textContent = value;
		} else {
			await super.applyProperty(prop, value, definition);
		}
	}
}
