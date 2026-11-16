# Recipe sharing: console commands (paste into the Appwrite console terminal)

Nothing in the app changes until you do both steps below and then turn sharing on for a family. Sharing starts OFF for every family.

**Step 1. Paste this first block.** Wait about 30 seconds before the second block. If a line seems to be cut off when you paste, paste the missing line again.

```
appwrite tablesdb create-table --database-id family --table-id recipePubs --name recipePubs --row-security false
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key authorId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key authorMembershipId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key sourceId --size 80 --required true
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key pubKey --size 190 --required true
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key hash --size 40 --required true
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key imageKey --size 16 --required false
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key photoId --size 36 --required false
appwrite tablesdb create-string-column --database-id family --table-id recipePubs --key status --size 12 --required true
appwrite tablesdb create-integer-column --database-id family --table-id recipePubs --key version --required false
appwrite tablesdb create-datetime-column --database-id family --table-id recipePubs --key hiddenAt --required false
appwrite tablesdb create-datetime-column --database-id family --table-id recipePubs --key publishedAt --required false
appwrite tablesdb create-text-column --database-id family --table-id recipePubs --key thumb --required false
appwrite tablesdb create-text-column --database-id family --table-id recipePubs --key data --required true
appwrite tablesdb create-table --database-id family --table-id recipeState --name recipeState --row-security false
appwrite tablesdb create-string-column --database-id family --table-id recipeState --key familyId --size 36 --required true
appwrite tablesdb create-boolean-column --database-id family --table-id recipeState --key enabled --required true
appwrite tablesdb create-string-column --database-id family --table-id recipeState --key enabledBy --size 36 --required false
appwrite tablesdb create-datetime-column --database-id family --table-id recipeState --key enabledAt --required false
```

**Step 2. Second block (indexes).** The unique one stops two taps at once from publishing the same recipe twice.

```
appwrite tablesdb create-index --database-id family --table-id recipePubs --key idx_family --type key --columns familyId
appwrite tablesdb create-index --database-id family --table-id recipePubs --key idx_hidden --type key --columns hiddenAt
appwrite tablesdb create-index --database-id family --table-id recipePubs --key uniq_pubKey --type unique --columns pubKey
```

**Step 3. Upload the function.** Upload `recipes-sharing-function.tar.gz` to the `family-api` function as a new deployment (same way as the last packages) and activate it. It contains all earlier features too, and the existing variables stay as they are. No new bucket is needed: photos use the same media bucket as Giving Center.

**Step 4. Turn it on for a family.** Open Recipes as the family owner. A card "Share recipes with [family]" appears. Tap "Turn on sharing". Other members see nothing new until it is on. Turning it on does not publish anything: every recipe stays private until its author publishes it.

Rollback: upload the previous function package (the app hides every sharing control when the server does not know the actions), or delete the `recipeState` row for a family to switch it off. Deleting the two tables removes all published copies; private recipes on people's devices are never touched.
