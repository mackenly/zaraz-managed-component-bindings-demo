import type { ComponentSettings, Manager } from '@managed-components/types'
import { DurableObject } from "cloudflare:workers";

interface PageviewData {
  url: string;
  timestamp: number;
  userAgent?: string;
  referer?: string;
}

interface QueueStatus {
  count: number;
  message: string;
}

/**
 * Durable Objects are stateful serverless objects that can be used to store data and state
 * in a persistent and consistent way.
 * 
 * Durable Objects can be used with a Zaraz Managed Component to queue data for later processing,
 * keep track of a user's session, or other data that needs to be persisted across requests.
 * 
 * In this example, we're using a Durable Object to queue pageviews for later processing.
 * The Durable Object is configured to process the queue 10 seconds after a pageview is received.
 * If pageviews are received in bursts, this will prevent spamming a hypothetical analytics API with requests.
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class LoggerQueue extends DurableObject {

  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Add a pageview to the queue and start timer only if not already running
   * @param pageviewData - The pageview data to add to the queue
   * @returns The current queue status
   */
  async addPageview(pageviewData: PageviewData): Promise<QueueStatus> {
    // Get current queue from storage
    const queue = await this.ctx.storage.get<PageviewData[]>('pageviewQueue') || [];
    
    // Add new pageview to queue
    queue.push(pageviewData);
    
    // Save updated queue
    await this.ctx.storage.put('pageviewQueue', queue);
    
    // Check if timer is already running
    const existingAlarm = await this.ctx.storage.getAlarm();
    
    // Only start timer if not already running
    if (!existingAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + 10000); // 10 seconds
    }
    
    return {
      count: queue.length,
      message: `Pageview added to queue. Total in queue: ${queue.length}`
    };
  }

  /**
   * Get the current queue status
   * @returns The current queue status
   */
  async getQueueStatus(): Promise<QueueStatus> {
    const queue = await this.ctx.storage.get<PageviewData[]>('pageviewQueue') || [];
    return {
      count: queue.length,
      message: `Current queue size: ${queue.length}`
    };
  }

  /**
   * Handle timer expiration - log all pageviews and clear queue
   */
  async alarm() {
    const queue = await this.ctx.storage.get<PageviewData[]>('pageviewQueue') || [];
    
    if (queue.length > 0) {
      console.log('=== PAGEVIEW QUEUE EXPIRED ===');
      console.log(`Processing ${queue.length} pageviews:`);
      
      queue.forEach((pageview, index) => {
        console.log(`[${index + 1}] ${new Date(pageview.timestamp).toISOString()} - ${pageview.url}`);
        if (pageview.userAgent) {
          console.log(`    User-Agent: ${pageview.userAgent}`);
        }
        if (pageview.referer) {
          console.log(`    Referer: ${pageview.referer}`);
        }
      });
      
      console.log('=== END PAGEVIEW QUEUE ===');
      
      // Clear the queue
      await this.ctx.storage.delete('pageviewQueue');
    }
  }
}

export default async function (manager: Manager, _settings: ComponentSettings) {
  manager.addEventListener('pageview', async event => {
    // Every unique ID refers to an individual instance of the Durable Object class
    const id = manager.ext?.env.LOGGER_QUEUE.idFromName("pageview-queue");

    // A stub is a client Object used to invoke methods defined by the Durable Object
    const stub = manager.ext?.env.LOGGER_QUEUE.get(id);

    // Prepare pageview data
    const pageviewData: PageviewData = {
      url: event.client.url.toString(),
      timestamp: Date.now(),
      userAgent: event.client.userAgent,
      referer: event.client.referer
    };

    try {
      // Add pageview to queue
      const queueStatus = await stub.addPageview(pageviewData);
      
      // Log on server side
      console.log(`Pageview received: ${pageviewData.url}`);
      console.log(queueStatus.message);
      
      // Log on client side
      event.client.execute(`
        console.log('Pageview request received:', '${pageviewData.url}');
        console.log('${queueStatus.message}');
      `);
      
    } catch (error) {
      console.error('Error adding pageview to queue:', error);
      event.client.execute(`
        console.error('Error processing pageview request');
      `);
    }
  });
}