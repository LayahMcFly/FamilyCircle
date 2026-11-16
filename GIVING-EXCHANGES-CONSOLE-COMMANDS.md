# Gift exchanges: console commands (paste into the Appwrite console terminal, one block at a time)

```
appwrite tablesdb create-table --database-id family --table-id givingExchanges --name givingExchanges --row-security false
appwrite tablesdb create-string-column --database-id family --table-id givingExchanges --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingExchanges --key organiserId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingExchanges --key status --size 10 --required true
appwrite tablesdb create-integer-column --database-id family --table-id givingExchanges --key round --required false
appwrite tablesdb create-string-column --database-id family --table-id givingExchanges --key data --size 3000 --required true
appwrite tablesdb create-table --database-id family --table-id givingExchangePairs --name givingExchangePairs --row-security false
appwrite tablesdb create-string-column --database-id family --table-id givingExchangePairs --key familyId --size 36 --required true
appwrite tablesdb create-string-column --database-id family --table-id givingExchangePairs --key data --size 2500 --required true
```

Wait a few seconds for the columns to finish creating, then:

```
appwrite tablesdb create-index --database-id family --table-id givingExchanges --key idx_family --type key --columns familyId
appwrite tablesdb create-index --database-id family --table-id givingExchangePairs --key idx_family --type key --columns familyId
```
