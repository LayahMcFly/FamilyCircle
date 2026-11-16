# Group gifts: console commands (paste into the Appwrite console terminal)

Paste this first block. Wait about 30 seconds before the second block. If a line seems to be cut off when you paste, paste the missing line again.

```
appwrite tablesdb create-table --database-id family --table-id givingGifts --name givingGifts --row-security false
appwrite tablesdb create-string-column --database-id family --table-id givingGifts --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGifts --key organiserId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGifts --key status --size 10 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGifts --key data --size 2500 --required true
appwrite tablesdb create-table --database-id family --table-id givingGiftParts --name givingGiftParts --row-security false
appwrite tablesdb create-string-column --database-id family --table-id givingGiftParts --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGiftParts --key giftId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGiftParts --key userId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGiftParts --key status --size 10 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGiftParts --key partKey --size 80 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingGiftParts --key data --size 400 --required true
```

Second block (indexes). The unique one stops two taps at once from making two rows for the same person.

```
appwrite tablesdb create-index --database-id family --table-id givingGifts --key idx_family --type key --columns familyId
appwrite tablesdb create-index --database-id family --table-id givingGiftParts --key idx_family --type key --columns familyId
appwrite tablesdb create-index --database-id family --table-id givingGiftParts --key idx_gift --type key --columns giftId
appwrite tablesdb create-index --database-id family --table-id givingGiftParts --key uniq_partKey --type unique --columns partKey
```
