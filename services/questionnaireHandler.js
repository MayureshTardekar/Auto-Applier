const profile = require('../config/profile');
const logger = require('../utils/logger');
const { randomDelay } = require('../utils/delay');

class QuestionnaireHandler {
  /**
   * Detects and answers modal questions or chatbot queries during application.
   * @param {import('puppeteer').Page} page
   * @returns {Promise<{ handled: boolean, success: boolean, reason?: string }>}
   */
  async handleQuestions(page) {
    try {
      // Check if a modal or chatbot container is present
      const modalPresent = await page.evaluate(() => {
        const dialogSelectors = [
          '.apply-message-container',
          '.drawer-wrapper',
          '.chatbot-container',
          '.modal-container',
          '.custom-questions',
          '[class*="questions-container"]',
          '[class*="apply-chatbot"]',
        ];
        return dialogSelectors.some((sel) => document.querySelector(sel) !== null);
      });

      if (!modalPresent) {
        return { handled: false, success: true };
      }

      logger.info('Detected recruiter questions or chatbot modal. Attempting automated response...');

      // Iteratively answer questions if multiple steps exist (up to 4 steps)
      for (let step = 0; step < 4; step++) {
        await randomDelay(1200, 2000);

        const outcome = await page.evaluate((profileData) => {
          let answeredCount = 0;

          const textMatch = (element, target) => {
            const content = (element.innerText || element.textContent || '').trim().toLowerCase();
            return content.includes(target.toLowerCase());
          };

          // 1. Notice Period Questions
          const noticeInputs = document.querySelectorAll('input, select, .radio-label, label');
          for (const el of noticeInputs) {
            const parentText = (el.parentElement ? el.parentElement.innerText : '').toLowerCase();
            if (parentText.includes('notice') || parentText.includes('joining')) {
              // Try finding 'immediate' or '0' or '< 15'
              if (textMatch(el, 'immediate') || textMatch(el, '0') || textMatch(el, '15 days')) {
                el.click();
                answeredCount++;
                break;
              }
            }
          }

          // 2. Experience Questions (Select 0 or fresher)
          for (const el of document.querySelectorAll('input, select, label')) {
            const parentText = (el.parentElement ? el.parentElement.innerText : '').toLowerCase();
            if (parentText.includes('experience') || parentText.includes('years of exp')) {
              if (el.tagName === 'SELECT') {
                el.value = '0';
                el.dispatchEvent(new Event('change', { bubbles: true }));
                answeredCount++;
              } else if (textMatch(el, '0') || textMatch(el, 'fresher')) {
                el.click();
                answeredCount++;
              }
            }
          }

          // 3. Expected Salary / CTC Questions
          for (const input of document.querySelectorAll('input[type="text"], input[type="number"]')) {
            const placeholder = (input.placeholder || '').toLowerCase();
            const parentText = (input.parentElement ? input.parentElement.innerText : '').toLowerCase();

            if (parentText.includes('expected ctc') || placeholder.includes('expected ctc') || parentText.includes('salary expectation')) {
              input.value = String(profileData.expectedCtcLakhs);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              answeredCount++;
            } else if (parentText.includes('current ctc') || placeholder.includes('current ctc')) {
              input.value = String(profileData.currentCtcLakhs);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              answeredCount++;
            }
          }

          // 4. Relocation Question
          for (const el of document.querySelectorAll('label, button, input[type="radio"]')) {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const parentText = (el.parentElement ? el.parentElement.innerText : '').toLowerCase();
            if (parentText.includes('relocate') || parentText.includes('relocation')) {
              if (text === 'yes' || text.startsWith('yes')) {
                el.click();
                answeredCount++;
                break;
              }
            }
          }

          // 5. Look for Submit, Next, Save, or Continue button
          const actionButtons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'));
          const submitBtn = actionButtons.find((btn) => {
            const btnText = (btn.innerText || btn.value || '').trim().toLowerCase();
            return (
              btnText === 'submit' ||
              btnText === 'save and apply' ||
              btnText === 'confirm' ||
              btnText === 'next' ||
              btnText === 'continue' ||
              btnText.includes('apply now')
            );
          });

          if (submitBtn) {
            submitBtn.click();
            return { submitted: true, answeredCount };
          }

          return { submitted: false, answeredCount };
        }, profile);

        logger.info(`Questionnaire step ${step + 1}: answered ${outcome.answeredCount} field(s).`);

        if (outcome.submitted) {
          await randomDelay(2000, 3500);
          // Check if modal closed or success displayed
          const stillOpen = await page.evaluate(() => {
            const modal = document.querySelector('.apply-message-container, .chatbot-container');
            return modal && modal.offsetParent !== null;
          });

          if (!stillOpen) {
            return { handled: true, success: true };
          }
        } else {
          // If no submit button could be found and unanswered fields remain
          break;
        }
      }

      return { handled: true, success: true };
    } catch (err) {
      logger.error('Error handling recruiter questionnaire', err);
      return { handled: true, success: false, reason: err.message };
    }
  }
}

module.exports = new QuestionnaireHandler();
