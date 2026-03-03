/**
 * Migration script to synchronize customer.project_groups_ids arrays
 * based on existing project_group.customer references
 * 
 * Usage:
 *   npx tsx tools/migrate-customer-project-groups-ids.ts          # dry run
 *   npx tsx tools/migrate-customer-project-groups-ids.ts --apply  # apply changes
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.development') });

interface Customer {
    _id: ObjectId;
    name?: string;
    project_groups_ids?: ObjectId[];
}

interface ProjectGroup {
    _id: ObjectId;
    name?: string;
    customer?: ObjectId;
}

async function migrateCustomerProjectGroupsIds(apply: boolean) {
    const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING!);
    
    try {
        await client.connect();
        const db = client.db(process.env.DB_NAME);
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Migration: Sync customer.project_groups_ids from group.customer`);
        console.log(`Mode: ${apply ? '🔴 APPLY' : '🟡 DRY RUN'}`);
        console.log(`${'='.repeat(60)}\n`);
        
        // Get all customers and project groups
        const customers = await db.collection<Customer>('automation_customers').find({}).toArray();
        const projectGroups = await db.collection<ProjectGroup>('automation_project_groups').find({}).toArray();
        
        console.log(`Found ${customers.length} customers, ${projectGroups.length} project groups\n`);
        
        // Build expected project_groups_ids for each customer based on group.customer
        const expectedGroupsByCustomer = new Map<string, Set<string>>();
        
        projectGroups.forEach(group => {
            if (group.customer) {
                const customerId = group.customer.toString();
                if (!expectedGroupsByCustomer.has(customerId)) {
                    expectedGroupsByCustomer.set(customerId, new Set());
                }
                expectedGroupsByCustomer.get(customerId)!.add(group._id.toString());
            }
        });
        
        // Check each customer
        let updatedCount = 0;
        let unchangedCount = 0;
        
        for (const customer of customers) {
            const customerId = customer._id.toString();
            const currentGroupIds = (customer.project_groups_ids ?? []).map(id => id.toString());
            const expectedGroupIds = Array.from(expectedGroupsByCustomer.get(customerId) ?? []);
            
            // Compare current vs expected
            const currentSet = new Set(currentGroupIds);
            const expectedSet = new Set(expectedGroupIds);
            
            const missing = expectedGroupIds.filter(id => !currentSet.has(id));
            const extra = currentGroupIds.filter(id => !expectedSet.has(id));
            
            if (missing.length === 0 && extra.length === 0) {
                unchangedCount++;
                console.log(`✅ ${customer.name || customerId}: OK (${currentGroupIds.length} groups)`);
                continue;
            }
            
            updatedCount++;
            console.log(`\n⚠️  ${customer.name || customerId}:`);
            console.log(`   Current: [${currentGroupIds.length}] ${currentGroupIds.join(', ') || 'empty'}`);
            console.log(`   Expected: [${expectedGroupIds.length}] ${expectedGroupIds.join(', ') || 'empty'}`);
            
            if (missing.length > 0) {
                console.log(`   Missing: ${missing.length} groups`);
                missing.forEach(groupId => {
                    const group = projectGroups.find(g => g._id.toString() === groupId);
                    console.log(`      + ${group?.name || groupId}`);
                });
            }
            
            if (extra.length > 0) {
                console.log(`   Extra: ${extra.length} groups (will be removed)`);
                extra.forEach(groupId => {
                    const group = projectGroups.find(g => g._id.toString() === groupId);
                    console.log(`      - ${group?.name || groupId}`);
                });
            }
            
            if (apply) {
                // Set the correct array
                const result = await db.collection('automation_customers').updateOne(
                    { _id: customer._id },
                    {
                        $set: {
                            project_groups_ids: expectedGroupIds.map(id => new ObjectId(id)),
                            updated_at: Date.now(),
                        },
                    }
                );
                console.log(`   ✅ Updated (modified: ${result.modifiedCount})`);
            } else {
                console.log(`   🟡 Would update (dry run)`);
            }
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Summary:`);
        console.log(`  Unchanged: ${unchangedCount} customers`);
        console.log(`  ${apply ? 'Updated' : 'To update'}: ${updatedCount} customers`);
        
        if (!apply && updatedCount > 0) {
            console.log(`\n💡 Run with --apply flag to apply changes`);
        }
        
        console.log(`${'='.repeat(60)}\n`);
        
    } finally {
        await client.close();
    }
}

// Parse command line arguments
const apply = process.argv.includes('--apply');

migrateCustomerProjectGroupsIds(apply)
    .then(() => {
        console.log('✅ Migration completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    });
