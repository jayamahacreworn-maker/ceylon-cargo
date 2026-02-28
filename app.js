import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    addDoc,
    collection,
    onSnapshot,
    query,
    orderBy,
    increment,
    Timestamp,
    setLogLevel,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAncJEHadZb3pkoCeZTf9RMUJW5OWr4O2w",
  authDomain: "ravi-cargo-ad731.firebaseapp.com",
  projectId: "ravi-cargo-ad731",
  storageBucket: "ravi-cargo-ad731.firebasestorage.app",
  messagingSenderId: "993400346851",
  appId: "1:993400346851:web:4681d29ec1d779c69ecdd6",
  measurementId: "G-C9HW3G4JCH"
};


const canvasFirebaseConfig = firebaseConfig;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'duminda-cargo-app';
let auth, db, userId;

let loginContainer, appContainer, mainContent;
let allShippersData = [];
let legacyCBMPrice = 0; // Renamed for clarity, used as fallback
let allTransactionsData = [];
let currentTotalBoxCBM = 0;
let incomeExpenseChart = null;

const customAlert = (title, message) => {
    const modal = document.getElementById('custom-alert-modal');
    const titleEl = document.getElementById('custom-alert-title');
    const messageEl = document.getElementById('custom-alert-message');

    if (modal && titleEl && messageEl) {
        titleEl.innerText = title;
        messageEl.innerText = message;
        modal.style.display = 'flex';
    } else {
        console.error("Custom alert modal elements not found in index.html!", { title, message });
        alert(`ALERT: ${title}\n\n${message}`);
    }
};

const handleLogin = async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const errorMessage = document.getElementById('login-error-message');

    if (!emailInput || !passwordInput || !errorMessage) {
        console.error("Login form elements not found!");
        customAlert('Error', 'Login form is broken. Please contact support.');
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;


    if (!email || !password) {
        errorMessage.innerText = "Please enter both email and password.";
        return;
    }

    errorMessage.innerText = "Logging in...";

    try {
        await signInWithEmailAndPassword(auth, email, password);
        errorMessage.innerText = "";
    } catch (error) {
        console.error("Login Error:", error.code, error.message);
        if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            errorMessage.innerText = "Invalid email or password.";
        } else if (error.code === 'auth/invalid-email') {
            errorMessage.innerText = "Please enter a valid email address.";
        } else {
            errorMessage.innerText = "An unexpected error occurred. Please try again.";
            console.error("Unhandled login error code:", error.code);
        }
    }
};

const handleLogout = async () => {
    console.log("Attempting logout...");
    try {
        await signOut(auth);
        console.log("Logout successful.");
    } catch (error) {
        console.error("Logout Error:", error);
        customAlert('Error', 'Failed to logout. Please try again.');
    }
};


const loadShippersForAutofill = () => {
    if (!db) {
        console.warn("Firestore (db) not initialized when trying to load shippers.");
        return;
    }
    const shippersRef = collection(db, `artifacts/${appId}/public/data/shippers`);
    const q = query(shippersRef, orderBy("name"));

    onSnapshot(q, (snapshot) => {
        allShippersData = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.name && data.email) {
                 allShippersData.push({
                     id: doc.id,
                     name: data.name,
                     email: data.email,
                     city: data.city || ''
                 });
            } else {
                console.warn("Skipping shipper doc due to missing name/email:", doc.id, data);
            }
        });
        console.log('Shippers list loaded/updated for autofill:', allShippersData.length);
        updateShipperDatalist();
    }, (error) => {
        console.error("Error loading/listening to shippers list: ", error);
        customAlert('Error', 'Could not load shipper list for autofill. Check Firestore rules or connection.');
        allShippersData = [];
    });
};

const updateShipperDatalist = () => {
    const datalist = document.getElementById('shippers-list');
    if (datalist) {
        datalist.innerHTML = '';
        allShippersData.forEach(s => {
            const option = document.createElement('option');
            option.value = s.name;
            datalist.appendChild(option);
        });
    } else {
    }
};

const handleShipperAutofill = (e) => {
    const inputName = e.target.value;
    const emailField = document.getElementById('shipperEmail');
    const cityField = document.getElementById('shipperCity');

    if (!emailField || !cityField) {
        console.error("Shipper Email or City field not found in the modal!");
        return;
    }

    const shipper = allShippersData.find(s => s.name.toLowerCase() === inputName.toLowerCase());

    if (shipper) {
        emailField.value = shipper.email || '';
        cityField.value = shipper.city || '';
        console.log("Autofilled shipper details for:", shipper.name);
    } else {
        if (inputName === '' || !allShippersData.some(s => s.name.toLowerCase().startsWith(inputName.toLowerCase()))) {
            emailField.value = '';
            cityField.value = '';
        }
    }
};

const calculateTotalPrice = () => {
    let totalBoxPrice = 0;
    let totalObjectPrice = 0;

    // Get the *selected* CBM price from the new dropdown
    const priceSelect = document.getElementById('cbm-price-select');
    const selectedPrice = priceSelect ? (parseFloat(priceSelect.value) || 0) : 0;

    document.querySelectorAll('#box-details-list .box-row:not([style*="display: none"])').forEach((row, index) => {
        const lengthCm = parseFloat(row.querySelector('.box-length')?.value) || 0;
        const widthCm = parseFloat(row.querySelector('.box-width')?.value) || 0;
        const heightCm = parseFloat(row.querySelector('.box-height')?.value) || 0;
        const priceDisplayElement = row.querySelector('.box-calculated-price');

        let calculatedBoxPrice = 0;
        if (lengthCm > 0 && widthCm > 0 && heightCm > 0) {
             if (selectedPrice > 0) { // <-- Uses selectedPrice from dropdown
                 const lengthM = lengthCm / 100;
                 const widthM = widthCm / 100;
                 const heightM = heightCm / 100;
                 const volumeCBM = lengthM * widthM * heightM;
                 calculatedBoxPrice = volumeCBM * selectedPrice; // <-- Uses selectedPrice from dropdown
                 totalBoxPrice += calculatedBoxPrice;
             } else {
                 // Warning is now more specific
                 if (priceSelect && !priceSelect.value) {
                     console.warn(`[calculateTotalPrice] No CBM price selected. Cannot calculate price for Box ${index+1}.`);
                 } else {
                     console.warn(`[calculateTotalPrice] Selected CBM Price is ${selectedPrice}, cannot calculate price for Box ${index+1}.`);
                 }
             }
        }

        if (priceDisplayElement) {
            priceDisplayElement.innerText = `€ ${calculatedBoxPrice.toFixed(2)}`;
        } else {
             console.warn(`[calculateTotalPrice] Price display element not found for Box ${index+1}.`);
        }
    });

    document.querySelectorAll('#other-objects-list .object-row:not([style*="display: none"])').forEach((row, index) => {
        const price = parseFloat(row.querySelector('.object-price')?.value) || 0;
        if (price >= 0) {
            totalObjectPrice += price;
        }
    });

    const subtotalPrice = totalBoxPrice + totalObjectPrice;
    
    const discountInput = document.getElementById('discountPrice');
    const discountPrice = discountInput ? (parseFloat(discountInput.value) || 0) : 0;
    
    const totalPrice = subtotalPrice - discountPrice;

    const subtotalPriceDisplay = document.getElementById('calculated-subtotal-price');
    if (subtotalPriceDisplay) {
        subtotalPriceDisplay.innerText = `€ ${subtotalPrice.toFixed(2)}`;
    }

    const totalPriceDisplay = document.getElementById('calculated-total-price');
    if (totalPriceDisplay) {
        totalPriceDisplay.innerText = `€ ${totalPrice.toFixed(2)}`;
    } else {
         console.error("[calculateTotalPrice] Total price display element (#calculated-total-price) not found!");
    }
    
    return totalPrice;
};

const addNewObjectRow = (objectData = null) => {
    const list = document.getElementById('other-objects-list');
    if (!list) {
        console.error("[addNewObjectRow] Object list element (#other-objects-list) not found!");
        return;
    }
    const template = document.querySelector('#add-box-modal .object-row[style*="display: none"]');
    if (!template) {
        console.error("CRITICAL [addNewObjectRow]: Template row ('#add-box-modal .object-row[style*=\"display: none\"]') NOT FOUND in index.html!");
        customAlert('Error', 'Could not add object row. UI Template missing.');
        return;
    }

    const row = template.cloneNode(true);
    row.style.display = '';

    const nameInput = row.querySelector('.object-name');
    const priceInput = row.querySelector('.object-price');

    if (objectData) {
        if (nameInput) nameInput.value = objectData.name || '';
        if (priceInput) priceInput.value = objectData.price || '';
    }

    if (priceInput) {
        priceInput.addEventListener('input', calculateTotalPrice);
    }

    const removeBtn = row.querySelector('.remove-object-btn');
    if(removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            row.remove();
            calculateTotalPrice();
        });
    }


    list.appendChild(row);
    if (window.lucide) {
        try { lucide.createIcons(); } catch(e){ console.error("Lucide icon creation error:", e); }
    }
    calculateTotalPrice();
};

const addNewBoxRow = (boxData = null, index = null) => {
    const list = document.getElementById('box-details-list');
    if (!list) {
         console.error("[addNewBoxRow] Box list element not found!");
         return;
    }

    const template = document.querySelector('#add-box-modal .box-row[style*="display: none"]');
     if (!template) {
        console.error("CRITICAL [addNewBoxRow]: Template row ('#add-box-modal .box-row[style*=\"display: none\"]') NOT FOUND in index.html!");
        customAlert('Error', 'Could not add box row. UI Template missing.');
        return;
    }
    const row = template.cloneNode(true);
    row.style.display = '';
    row.classList.remove('hidden');

    const boxCount = list.querySelectorAll('.box-row:not([style*="display: none"])').length + 1;
    const boxNumberSpan = row.querySelector('.box-number');
     if (boxNumberSpan) boxNumberSpan.innerText = boxCount;


    const lengthInput = row.querySelector('.box-length');
    const widthInput = row.querySelector('.box-width');
    const heightInput = row.querySelector('.box-height');
    const priceDisplay = row.querySelector('.box-calculated-price');

    // Get the *currently selected* CBM price from the dropdown for calculation
    const priceSelect = document.getElementById('cbm-price-select');
    const selectedPrice = priceSelect ? (parseFloat(priceSelect.value) || 0) : 0;

    if (boxData) {
        if(lengthInput) lengthInput.value = boxData.length || '';
        if(widthInput) widthInput.value = boxData.width || '';
        if(heightInput) heightInput.value = boxData.height || '';

         let calculatedBoxPrice = 0;
         // Use the price from the dropdown (selectedPrice)
         if (boxData.length > 0 && boxData.width > 0 && boxData.height > 0 && selectedPrice > 0) {
             const lengthM = boxData.length / 100;
             const widthM = boxData.width / 100;
             const heightM = boxData.height / 100;
             const volumeCBM = lengthM * widthM * heightM;
             calculatedBoxPrice = volumeCBM * selectedPrice;
         }
         if (priceDisplay) priceDisplay.innerText = `€ ${calculatedBoxPrice.toFixed(2)}`;
    } else {
        if (priceDisplay) priceDisplay.innerText = '€ 0.00';
    }

    [lengthInput, widthInput, heightInput].forEach(input => {
        if (input) input.addEventListener('input', calculateTotalPrice);
    });

    const removeBtn = row.querySelector('.remove-box-btn');
    if(removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            row.remove();
            calculateTotalPrice();
             list.querySelectorAll('.box-row:not([style*="display: none"])').forEach((remainingRow, idx) => {
                 const numSpan = remainingRow.querySelector('.box-number');
                 if (numSpan) numSpan.innerText = idx + 1;
             });
        });
    }


    list.appendChild(row);
    if (window.lucide) {
       try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
    }
};

const togglePayingDate = () => {
    const statusSelect = document.getElementById('paymentStatus');
    const dateContainer = document.getElementById('payingDateContainer');
    const dateInput = document.getElementById('payingDate');

    if (!statusSelect || !dateContainer || !dateInput) {
        console.warn("togglePayingDate: Missing required elements (paymentStatus, payingDateContainer, or payingDate).");
        return;
    }

    if (statusSelect.value === 'Unpaid') {
        dateContainer.style.display = 'block';
    } else {
        dateContainer.style.display = 'none';
        dateInput.value = '';
    }
};

const openAddBoxModal = (isEditing = false) => {
    const modal = document.getElementById('add-box-modal');
    const titleEl = document.getElementById('add-edit-modal-title');
    const submitBtn = document.getElementById('add-edit-submit-btn');
    const form = document.getElementById('add-box-form');

    if(modal && titleEl && submitBtn && form) {
        form.removeEventListener('input', handleModalInputChange);
        document.getElementById('add-other-object-btn')?.removeEventListener('click', addNewObjectRow);
        document.getElementById('add-new-box-btn')?.removeEventListener('click', addNewBoxRow);
        document.getElementById('shipperName')?.removeEventListener('input', handleShipperAutofill);
        document.getElementById('paymentStatus')?.removeEventListener('change', togglePayingDate);
        // Remove listener for the new dropdown as well
        document.getElementById('cbm-price-select')?.removeEventListener('change', calculateTotalPrice);


        if (isEditing) {
            titleEl.innerText = "Edit Shipment / Box";
            submitBtn.innerText = "Update Entry";
        } else {
            titleEl.innerText = "Add New Shipment / Box";
            submitBtn.innerText = "Add Entry";
             form.reset();
             const boxList = document.getElementById('box-details-list');
             const objectList = document.getElementById('other-objects-list');
             const editIdField = document.getElementById('editDocId');
             
             // Clear hidden fields for past shipment editing
             document.getElementById('editShipmentId').value = '';
             document.getElementById('editShipmentIndex').value = '';

             const objTemplate = document.querySelector('#add-box-modal .object-row[style*="display: none"]');
             if(objectList) { objectList.innerHTML = ''; if(objTemplate) objectList.appendChild(objTemplate.cloneNode(true)); }
             const boxTemplate = document.querySelector('#add-box-modal .box-row[style*="display: none"]');
             if(boxList) { boxList.innerHTML = ''; if(boxTemplate) boxList.appendChild(boxTemplate.cloneNode(true)); }

             if(editIdField) editIdField.value = '';
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        updateShipperDatalist();
        togglePayingDate();

        document.getElementById('add-other-object-btn')?.addEventListener('click', addNewObjectRow);
        document.getElementById('add-new-box-btn')?.addEventListener('click', addNewBoxRow);
        document.getElementById('shipperName')?.addEventListener('input', handleShipperAutofill);
        document.getElementById('paymentStatus')?.addEventListener('change', togglePayingDate);
        // Add listener for the new dropdown
        document.getElementById('cbm-price-select')?.addEventListener('change', calculateTotalPrice);
        form.addEventListener('input', handleModalInputChange);


        if (window.lucide) {
           try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
        }
        calculateTotalPrice();
    } else {
        console.error("Add/Edit Modal essential elements not found!");
    }
};

const handleModalInputChange = (e) => {
    if (e.target && (e.target.matches('.box-dimension') || e.target.matches('.object-price') || e.target.id === 'discountPrice')) {
        calculateTotalPrice();
    }
};

const closeAddBoxModal = () => {
    const modal = document.getElementById('add-box-modal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    const form = document.getElementById('add-box-form');
    if (form) {
         form.reset();
         form.removeEventListener('input', handleModalInputChange);
    }
    
    // --- ME TIKA WENAS KALE ---
    const editIdField = document.getElementById('editDocId');
    if(editIdField) editIdField.value = '';
    
    const editShipmentIdField = document.getElementById('editShipmentId');
    if(editShipmentIdField) editShipmentIdField.value = '';
    
    const editShipmentIndexField = document.getElementById('editShipmentIndex');
    if(editShipmentIndexField) editShipmentIndexField.value = '';
    // --- WENAS KAMA IWARAI ---


    const objList = document.getElementById('other-objects-list');
    const boxList = document.getElementById('box-details-list');
     const objTemplate = document.querySelector('#add-box-modal .object-row[style*="display: none"]');
     if(objList) { objList.innerHTML = ''; if(objTemplate) objList.appendChild(objTemplate.cloneNode(true)); }
     const boxTemplate = document.querySelector('#add-box-modal .box-row[style*="display: none"]');
     if(boxList) { boxList.innerHTML = ''; if(boxTemplate) boxList.appendChild(boxTemplate.cloneNode(true)); }


    document.getElementById('add-other-object-btn')?.removeEventListener('click', addNewObjectRow);
    document.getElementById('add-new-box-btn')?.removeEventListener('click', addNewBoxRow);
    document.getElementById('shipperName')?.removeEventListener('input', handleShipperAutofill);
    document.getElementById('paymentStatus')?.removeEventListener('change', togglePayingDate);
    // Remove listener for the new dropdown
    document.getElementById('cbm-price-select')?.removeEventListener('change', calculateTotalPrice);

    const dateFieldContainer = document.getElementById('payingDateContainer');
    if (dateFieldContainer) dateFieldContainer.style.display = 'none';

    const subtotalPriceDisplay = document.getElementById('calculated-subtotal-price');
    if (subtotalPriceDisplay) subtotalPriceDisplay.innerText = '€ 0.00';

    const discountInput = document.getElementById('discountPrice');
    if (discountInput) discountInput.value = '0';

    const totalPriceDisplay = document.getElementById('calculated-total-price');
    if (totalPriceDisplay) totalPriceDisplay.innerText = '€ 0.00';
};

const populateEditForm = (boxData) => {
    const form = document.getElementById('add-box-form');
    if (!form || !boxData) return;

    form.boxNo.value = boxData.boxNo || '';
    form.quantity.value = boxData.quantity || 1;
    form.shipperName.value = boxData.shipperName || '';
    form.shipperEmail.value = boxData.shipperEmail || '';
    form.shipperCity.value = boxData.shipperCity || '';
    form.receiverName.value = boxData.receiverName || '';
    form.receiverPhone.value = boxData.receiverPhone || '';
    form.receiverAddress.value = boxData.receiverAddress || '';
    form.boxNotes.value = boxData.notes || '';

    form.paymentStatus.value = boxData.paymentStatus || 'Paid';
    form.payingDate.value = boxData.payingDate || '';
    togglePayingDate();

    form.discountPrice.value = boxData.discountAmount || 0;

    // Set the CBM price dropdown
    const cbmPriceSelect = document.getElementById('cbm-price-select');
    if (cbmPriceSelect && boxData.cbmPriceUsed !== undefined) {
        // Check if an option with this *value* exists
        let matchingOption = Array.from(cbmPriceSelect.options).find(opt => parseFloat(opt.value) === boxData.cbmPriceUsed);
        if (matchingOption) {
            cbmPriceSelect.value = matchingOption.value;
        } else {
            // If the exact price isn't saved anymore, try to match by name
            matchingOption = Array.from(cbmPriceSelect.options).find(opt => opt.text === boxData.cbmPriceName);
            if (matchingOption) {
                cbmPriceSelect.value = matchingOption.value;
            } else {
                // If still no match, add it as a temporary option
                console.warn(`Saved CBM price (${boxData.cbmPriceName}: ${boxData.cbmPriceUsed}) not found in current price list. Adding it temporarily.`);
                const tempOption = document.createElement('option');
                tempOption.value = boxData.cbmPriceUsed;
                tempOption.text = `${boxData.cbmPriceName || 'Saved Price'} (€ ${boxData.cbmPriceUsed.toFixed(2)})`;
                tempOption.selected = true;
                cbmPriceSelect.appendChild(tempOption);
            }
        }
    } else if (cbmPriceSelect) {
        cbmPriceSelect.value = ''; // Reset if no price was saved
    }


    const boxList = document.getElementById('box-details-list');
    const objectList = document.getElementById('other-objects-list');
     const objTemplate = document.querySelector('#add-box-modal .object-row[style*="display: none"]');
     if(objectList) { objectList.innerHTML = ''; if(objTemplate) objectList.appendChild(objTemplate.cloneNode(true)); }
     const boxTemplate = document.querySelector('#add-box-modal .box-row[style*="display: none"]');
     if(boxList) { boxList.innerHTML = ''; if(boxTemplate) boxList.appendChild(boxTemplate.cloneNode(true)); }


    if (boxData.boxes && Array.isArray(boxData.boxes)) {
        // Call addNewBoxRow *after* setting the CBM price dropdown
        boxData.boxes.forEach((box, index) => addNewBoxRow(box, index));
    }

    if (boxData.otherObjects && Array.isArray(boxData.otherObjects)) {
        boxData.otherObjects.forEach(obj => addNewObjectRow(obj));
    }
};

const handleEditBox = async (docId) => {
    if (!db || !docId) return customAlert('Error', 'Cannot edit entry. Invalid ID.');
    customAlert('Loading...', 'Loading entry data for editing...');
    try {
        const boxDocRef = doc(db, `artifacts/${appId}/public/data/boxes`, docId);
        const docSnap = await getDoc(boxDocRef);
        if (docSnap.exists()) {
            populateEditForm(docSnap.data());
            const editIdField = document.getElementById('editDocId');
            if(editIdField) editIdField.value = docId;
            openAddBoxModal(true);
            const alertModal = document.getElementById('custom-alert-modal');
            if(alertModal) alertModal.style.display = 'none';
        } else {
            customAlert('Error', 'Entry not found.');
             const alertModal = document.getElementById('custom-alert-modal');
             if(alertModal) alertModal.style.display = 'none';
        }
    } catch (error) {
        console.error("Error fetching document for edit: ", error);
        customAlert('Error', 'Failed to load entry data.');
         const alertModal = document.getElementById('custom-alert-modal');
         if(alertModal) alertModal.style.display = 'none';
    }
};

const populateDetailsModal = (boxData) => {
    if (!boxData) return;

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text || 'N/A';
    };

     const setPrice = (id, price) => {
        const el = document.getElementById(id);
        if (el) el.innerText = (price !== undefined && typeof price === 'number') ? `€ ${price.toFixed(2)}` : 'N/A';
    };


    const formatDate = (timestamp) => {
        if (timestamp && timestamp.toDate) {
            return timestamp.toDate().toLocaleString('si-LK', { dateStyle: 'short', timeStyle: 'short' });
        } else if (timestamp instanceof Date) {
             return timestamp.toLocaleString('si-LK', { dateStyle: 'short', timeStyle: 'short' });
        } else if (timestamp && typeof timestamp.seconds === 'number') {
             try { return new Date(timestamp.seconds * 1000).toLocaleString('si-LK', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return 'Invalid Date'; }
        }
        return 'N/A';
    };

    setText('details-box-no', boxData.boxNo);
    setText('details-shipper-name', boxData.shipperName);
    setText('details-shipper-email', boxData.shipperEmail);
    setText('details-shipper-city', boxData.shipperCity);
    setText('details-receiver-name', boxData.receiverName);
    setText('details-receiver-phone', boxData.receiverPhone);
    setText('details-receiver-address', boxData.receiverAddress);
    setText('details-notes', boxData.notes || 'No notes added.');
    setText('details-quantity', boxData.quantity);
    setText('details-added-at', formatDate(boxData.addedAt));
    setText('details-added-by', boxData.addedBy);

    const subtotal = boxData.subtotalPrice !== undefined ? boxData.subtotalPrice : boxData.totalCalculatedPrice;
    const discount = boxData.discountAmount || 0;
    
    setPrice('details-subtotal-price', subtotal);
    setPrice('details-discount-price', discount);

    setPrice('details-total-price', boxData.totalCalculatedPrice);

    setText('details-payment-status', boxData.paymentStatus || 'N/A');
    setText('details-paying-date', boxData.payingDate || 'N/A');

    // Get the price that was used when saving this entry
    // Fallback to the legacy global price if it wasn't saved
    const priceToUse = (boxData.cbmPriceUsed !== undefined) ? boxData.cbmPriceUsed : legacyCBMPrice;

    const boxListDiv = document.getElementById('details-box-list');
    if (boxListDiv) {
        if (boxData.boxes && boxData.boxes.length > 0) {
            boxListDiv.innerHTML = boxData.boxes.map((box, index) => {
                let calculatedBoxPrice = 0;
                 // Use the saved price (priceToUse)
                 if (box.length > 0 && box.width > 0 && box.height > 0 && priceToUse > 0) {
                     const lengthM = box.length / 100;
                     const widthM = box.width / 100;
                     const heightM = box.height / 100;
                     const volumeCBM = lengthM * widthM * heightM;
                     calculatedBoxPrice = volumeCBM * priceToUse; // <-- Uses priceToUse
                 }
                return `
                    <div class="text-sm bg-gray-700 p-3 rounded grid grid-cols-2 gap-x-4">
                        <strong class="text-purple-300 col-span-2">Box ${index + 1}:</strong>
                        <span>L: ${box.length || '?'}cm</span>
                        <span>W: ${box.width || '?'}cm</span>
                        <span>H: ${box.height || '?'}cm</span>
                        <span>Calc. Price: € ${calculatedBoxPrice.toFixed(2)}</span>
                        ${box.weight ? `<span>Wt: ${box.weight}kg</span>` : ''} </div>
                `;
            }).join('');
        } else {
            boxListDiv.innerHTML = '<p class="text-gray-400 text-sm">No individual box details added.</p>';
        }
    }

    const objectListDiv = document.getElementById('details-object-list');
     if (objectListDiv) {
         if (boxData.otherObjects && boxData.otherObjects.length > 0) {
            objectListDiv.innerHTML = boxData.otherObjects.map(obj => `
                <div class="text-sm flex justify-between bg-gray-700 px-3 py-2 rounded">
                    <span class="text-yellow-300">${obj.name || 'Unnamed Object'}</span>
                    <span class="text-gray-300">€ ${obj.price ? obj.price.toFixed(2) : '0.00'}</span>
                </div>
            `).join('');
        } else {
             objectListDiv.innerHTML = '<p class="text-gray-400 text-sm">No other objects added.</p>';
        }
    }
};

const handleViewDetails = async (docId) => {
    if (!db || !docId) return customAlert('Error', 'Cannot view details. Invalid ID.');
    customAlert('Loading...', 'Loading entry details...');
    try {
        const boxDocRef = doc(db, `artifacts/${appId}/public/data/boxes`, docId);
        const docSnap = await getDoc(boxDocRef);
        if (docSnap.exists()) {
            populateDetailsModal(docSnap.data());
            const modal = document.getElementById('view-details-modal');
            if (modal) {
                 modal.dataset.currentDocId = docId;
                 delete modal.dataset.currentData;
                 modal.classList.remove('hidden');
                 modal.classList.add('flex');
                 if(window.lucide) {
                    try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
                 }
            }
            const alertModal = document.getElementById('custom-alert-modal');
            if(alertModal) alertModal.style.display = 'none';
        } else {
            customAlert('Error', 'Entry not found.');
             const alertModal = document.getElementById('custom-alert-modal');
             if(alertModal) alertModal.style.display = 'none';
        }
    } catch (error) {
        console.error("Error fetching document for view: ", error);
        customAlert('Error', 'Failed to load entry details.');
         const alertModal = document.getElementById('custom-alert-modal');
         if(alertModal) alertModal.style.display = 'none';
    }
};

const closeViewDetailsModal = () => {
     const modal = document.getElementById('view-details-modal');
     if (modal) {
         modal.classList.add('hidden');
         modal.classList.remove('flex');
         delete modal.dataset.currentDocId;
         delete modal.dataset.currentData;
     }
};


async function loadContent(pageName) {
    if (!mainContent) {
        console.error("Main content area not found!");
        return;
    }

    try {
        console.log(`Loading content for: ${pageName}.html`);
        const response = await fetch(`${pageName}.html`);
        if (!response.ok) {
            throw new Error(`Could not load ${pageName}.html. Status: ${response.status} ${response.statusText}`);
        }
        mainContent.innerHTML = await response.text();

        if (window.lucide) {
           try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
        } else {
            console.warn("Lucide library not loaded.");
        }

        if (pageName === 'shippers-database') {
            loadShippersData();
        }
        else if (pageName === 'changes') {
            await loadCbmPrices(); // <-- New function
            loadSavedContainers();
        }
        else if (pageName === 'add-boxes') {
            loadBoxesTable(); 
            
            document.getElementById('show-add-box-modal-btn')?.addEventListener('click', () => openAddBoxModal(false));
            
            document.getElementById('end-all-entries-btn')?.addEventListener('click', handleEndAllEntries);

            document.getElementById('filterCustomerName')?.addEventListener('keyup', filterBoxesTable);
            document.getElementById('filterBoxNo')?.addEventListener('keyup', filterBoxesTable);
            document.getElementById('filterDate')?.addEventListener('change', filterBoxesTable);
            document.getElementById('filterPaymentStatus')?.addEventListener('change', filterBoxesTable);
            document.getElementById('filterPayingDate')?.addEventListener('change', filterBoxesTable);
            document.getElementById('filterClearBtn')?.addEventListener('click', () => {
                const nameFilter = document.getElementById('filterCustomerName');
                const boxNoFilter = document.getElementById('filterBoxNo');
                const dateFilter = document.getElementById('filterDate');
                const statusFilter = document.getElementById('filterPaymentStatus');
                const payingDateFilter = document.getElementById('filterPayingDate');
                if (nameFilter) nameFilter.value = '';
                if (boxNoFilter) boxNoFilter.value = '';
                if (dateFilter) dateFilter.value = '';
                if (statusFilter) statusFilter.value = 'All';
                if (payingDateFilter) payingDateFilter.value = '';
                filterBoxesTable();
            });

            populateContainerDropdown(); 
            
            const containerSelect = document.getElementById('container-select-dropdown');
            if (containerSelect) {
                containerSelect.addEventListener('change', () => {
                    updateLoadingPlanUI(); 
                });
            }
        }
        
        else if (pageName === 'past-shipments') {
            loadPastShipments();
        }

        else if (pageName === 'dashboard') {
             listenForTransactions(); 
             loadBoxesTable(); 
             populateContainerDropdown();
             
             const containerSelect = document.getElementById('container-select-dropdown');
             if (containerSelect) {
                 containerSelect.addEventListener('change', () => {
                     updateLoadingPlanUI(); 
                 });
             }
             
             loadDashboardCardStats();
        }
        
        else if (pageName === 'income-expenses') {
            loadIncomeExpensesPage();
        }


    } catch (error) {
        console.error("Error loading content:", error);
        mainContent.innerHTML = `<h1 class="text-3xl font-bold text-red-500">Error loading page.</h1><p>${error.message}</p>`;
    }
}

function initializeNavigation() {
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPage = link.getAttribute('data-target');
            if (!targetPage) {
                console.warn("Sidebar link clicked with no data-target:", link);
                return;
            }
            sidebarLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            loadContent(targetPage);
        });
    });
}

async function handleAddBox(e) {
    e.preventDefault();
    if (!db) return customAlert('Error', 'Database not connected.');

    const form = e.target;
    const messageDiv = document.getElementById('form-message');
    
    // --- ME TIKA WENAS KALE ---
    const editDocId = document.getElementById('editDocId').value;
    const editShipmentId = document.getElementById('editShipmentId').value;
    const editShipmentIndex = document.getElementById('editShipmentIndex').value;
    // --- WENAS KAMA IWARAI ---


    const otherObjects = [];
    document.querySelectorAll('#other-objects-list .object-row:not([style*="display: none"])').forEach(row => {
        const nameInput = row.querySelector('.object-name');
        const priceInput = row.querySelector('.object-price');
        if (nameInput && priceInput) {
            const name = nameInput.value.trim();
            const price = parseFloat(priceInput.value) || 0;
            if (name && price >= 0) {
                otherObjects.push({ name, price });
            }
        }
    });

    const boxes = [];
    document.querySelectorAll('#box-details-list .box-row:not([style*="display: none"])').forEach(row => {
        const length = parseFloat(row.querySelector('.box-length').value) || 0;
        const width = parseFloat(row.querySelector('.box-width').value) || 0;
        const height = parseFloat(row.querySelector('.box-height').value) || 0;
        if (length > 0 && width > 0 && height > 0) {
            boxes.push({ length, width, height });
        }
    });

    const subtotalPrice = (document.getElementById('calculated-subtotal-price')?.innerText || '€ 0.00')
                            .replace('€ ', '');
    const discountPrice = (document.getElementById('discountPrice')?.value || 0);

    const calculatedTotalPrice = calculateTotalPrice();

    const paymentStatus = form.paymentStatus.value;
    const payingDate = form.payingDate.value;

    // Get the selected CBM price details
    const priceSelect = document.getElementById('cbm-price-select');
    const selectedPriceValue = priceSelect ? (parseFloat(priceSelect.value) || 0) : 0;
    const selectedPriceName = priceSelect ? (priceSelect.options[priceSelect.selectedIndex]?.text || 'N/A') : 'N/A';

    const boxData = {
        boxNo: form.boxNo.value.trim(),
        quantity: parseInt(form.quantity.value) || 1,
        shipperName: form.shipperName.value.trim(),
        shipperEmail: form.shipperEmail.value.toLowerCase().trim(),
        shipperCity: form.shipperCity.value.trim(),
        receiverName: form.receiverName.value.trim(),
        receiverPhone: form.receiverPhone.value.trim(),
        receiverAddress: form.receiverAddress.value.trim(),
        notes: form.boxNotes.value.trim(),
        otherObjects: otherObjects,
        boxes: boxes,
        
        subtotalPrice: parseFloat(subtotalPrice),
        discountAmount: parseFloat(discountPrice),
        totalCalculatedPrice: calculatedTotalPrice,

        // Save the CBM price details
        cbmPriceUsed: selectedPriceValue,
        cbmPriceName: selectedPriceName, 
        
        paymentStatus: paymentStatus,
        payingDate: (paymentStatus === 'Unpaid' && payingDate) ? payingDate : null, 
        addedBy: userId || 'unknown',
        lastUpdatedAt: Timestamp.fromDate(new Date())
    };

    if (!editDocId && !editShipmentId) { // Aluth entry ekak nam vitharak
        boxData.addedAt = Timestamp.fromDate(new Date());
    }

    if (!boxData.boxNo || !boxData.shipperName || !boxData.shipperEmail || !boxData.receiverName || !boxData.receiverPhone || !boxData.receiverAddress) {
         customAlert('Validation Error', 'Please fill in all required fields (Box No, Shipper Name/Email, Receiver Name/Phone/Address).');
         return;
    }

    // Check if CBM price is selected
    if (selectedPriceValue <= 0) {
        customAlert('Validation Error', 'Please select a valid CBM Price from the dropdown.');
        return;
    }


    try {
        if (editShipmentId && editShipmentIndex !== undefined) {
            // === LOGIC FOR PAST SHIPMENT EDIT ===
            console.log(`Updating entry ${editShipmentIndex} in shipment ${editShipmentId}`);
            
            const shipmentDocRef = doc(db, `artifacts/${appId}/public/data/shipments`, editShipmentId);
            const docSnap = await getDoc(shipmentDocRef);
            
            if (!docSnap.exists()) {
                throw new Error("Shipment document not found. Could not update entry.");
            }

            const shipmentData = docSnap.data();
            let entries = shipmentData.entries || [];
            const index = parseInt(editShipmentIndex);
            const originalEntry = entries[index] || {};
            
            // Update the entry in the array
            // 'addedAt' vage parana fields preserve karanava
            entries[index] = { 
                ...originalEntry, // Parana details
                ...boxData        // Aluth details (form eken)
            }; 

            // Shipment eke total price eka ayeth calculate karanava
            let newTotalPrice = 0;
            entries.forEach(entry => {
                newTotalPrice += entry.totalCalculatedPrice || 0;
            });

            // Shipment document eka update karanava
            await setDoc(shipmentDocRef, {
                entries: entries,
                totalPrice: newTotalPrice,
                lastUpdatedAt: Timestamp.fromDate(new Date())
            }, { merge: true });

            if (messageDiv) messageDiv.innerText = 'Entry updated successfully in shipment!';
            closeAddBoxModal();
            
            // Details page eka refresh karanava
            const updatedShipmentData = { ...shipmentData, entries: entries, totalPrice: newTotalPrice, lastUpdatedAt: Timestamp.fromDate(new Date()) };
            renderShipmentDetails(updatedShipmentData, editShipmentId);
            if (window.setupShipmentPDF) {
                window.setupShipmentPDF(editShipmentId, updatedShipmentData);
            }
            
        } else {
            // === LOGIC FOR NEW OR LIVE-EDIT ENTRY ===
            const shipperId = boxData.shipperEmail;
            const receiverPhone = boxData.receiverPhone;

            if (editDocId) {
                // --- This is a LIVE EDIT ---
                console.log("Updating document:", editDocId);
                const boxDocRef = doc(db, `artifacts/${appId}/public/data/boxes`, editDocId);
                await setDoc(boxDocRef, boxData, { merge: true });

                const shipperRef = doc(db, `artifacts/${appId}/public/data/shippers`, shipperId);
                await setDoc(shipperRef, { name: boxData.shipperName, email: shipperId, city: boxData.shipperCity }, { merge: true });

                const receiverRef = doc(db, `artifacts/${appId}/public/data/shippers/${shipperId}/receivers`, receiverPhone);
                await setDoc(receiverRef, { name: boxData.receiverName, address: boxData.receiverAddress, phone: receiverPhone }, { merge: true });

                const shipperBoxRef = doc(db, `artifacts/${appId}/public/data/shippers/${shipperId}/shipment_entries`, editDocId);
                await setDoc(shipperBoxRef, {
                    boxNo: boxData.boxNo,
                    addedAt: boxData.lastUpdatedAt,
                    totalPrice: boxData.totalCalculatedPrice
                }, { merge: true });
                
                if(messageDiv) messageDiv.innerText = 'Entry updated successfully!';

            } else {
                // --- This is a NEW ENTRY ---
                console.log("Adding new document...");
                const boxesCollectionRef = collection(db, `artifacts/${appId}/public/data/boxes`);
                const docRef = await addDoc(boxesCollectionRef, boxData);
                const newBoxId = docRef.id;

                const shipperRef = doc(db, `artifacts/${appId}/public/data/shippers`, shipperId);
                await setDoc(shipperRef, { name: boxData.shipperName, email: shipperId, city: boxData.shipperCity, shipmentCount: increment(1) }, { merge: true });

                const receiverRef = doc(db, `artifacts/${appId}/public/data/shippers/${shipperId}/receivers`, receiverPhone);
                await setDoc(receiverRef, { name: boxData.receiverName, address: boxData.receiverAddress, phone: receiverPhone }, { merge: true });

                const shipperBoxRef = doc(db, `artifacts/${appId}/public/data/shippers/${shipperId}/shipment_entries`, newBoxId);
                await setDoc(shipperBoxRef, {
                    boxNo: boxData.boxNo,
                    addedAt: boxData.addedAt,
                    totalPrice: boxData.totalCalculatedPrice
                });
                
                if(messageDiv) messageDiv.innerText = 'Entry added successfully!';
            }
            
            if(messageDiv) messageDiv.className = 'mt-4 text-center text-green-400';
            closeAddBoxModal();
        }

    } catch (error) {
        console.error("Error saving document: ", error);
        if(messageDiv) {
            messageDiv.innerText = `Error ${editDocId ? 'updating' : 'adding'} entry. Please try again.`;
            messageDiv.className = 'mt-4 text-center text-red-400';
        }
        customAlert('Save Error', `Failed to ${editDocId ? 'update' : 'add'} entry: ${error.message}`);
    }

    setTimeout(() => {
        if(messageDiv) messageDiv.innerText = '';
    }, 4000);
}

async function loadDashboardCardStats() {
    if (!db) return;

    const boxesEl = document.getElementById('dashboard-total-boxes');
    const shippersEl = document.getElementById('dashboard-total-shippers');
    const shipmentsEl = document.getElementById('dashboard-active-shipments');

    try {
        const boxesQuery = query(collection(db, `artifacts/${appId}/public/data/boxes`));
        onSnapshot(boxesQuery, (boxesSnap) => {
            if (boxesEl) boxesEl.innerText = boxesSnap.size;
        });

        const shippersQuery = query(collection(db, `artifacts/${appId}/public/data/shippers`));
        onSnapshot(shippersQuery, (shippersSnap) => {
            if (shippersEl) shippersEl.innerText = shippersSnap.size;
        });

        const shipmentsQuery = query(collection(db, `artifacts/${appId}/public/data/shipments`));
        onSnapshot(shipmentsQuery, (shipmentsSnap) => {
            if (shipmentsEl) shipmentsEl.innerText = shipmentsSnap.size;
        });

    } catch (error) {
        console.error("Error loading dashboard card stats: ", error);
        if (boxesEl) boxesEl.innerText = 'Err';
        if (shippersEl) shippersEl.innerText = 'Err';
        if (shipmentsEl) shipmentsEl.innerText = 'Err';
    }
}

function loadShippersData() {
    if (!db) return;
    const tableBody = document.getElementById('shippers-table-body');
    if (!tableBody) return;

    const shippersCollectionRef = collection(db, `artifacts/${appId}/public/data/shippers`);
    const q = query(shippersCollectionRef, orderBy("name"));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-gray-400">No shippers found.</td></tr>`;
            return;
        }

        tableBody.innerHTML = '';
        snapshot.forEach(doc => {
            const shipper = doc.data();
            const shipperId = doc.id;
            const shipmentCount = shipper.shipmentCount || 0;
            const shipperName = shipper.name || 'N/A';

            const row = `
                <tr class="hover:bg-gray-700 transition-colors duration-150">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${shipperName}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${shipper.email || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${shipper.city || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${shipmentCount}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button data-id="${shipperId}" data-name="${shipperName.replace(/"/g, '&quot;')}" class="text-blue-400 hover:text-blue-300 view-shipper-shipments">
                            View Shipments (${shipmentCount})
                        </button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });

    }, (error) => {
        console.error("Error loading shippers: ", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-red-400">Error loading data.</td></tr>`;
        customAlert('Error', `Failed to load shippers: ${error.message}`);
    });
}

async function loadShipperShipmentsPage(shipperId, shipperName) {
    if (!mainContent) return;
    
    const html = `
        <div class="flex justify-between items-center mb-8">
            <div>
                <h1 class="text-3xl font-bold">Shipments for</h1>
                <h2 class="text-xl font-medium text-blue-300">${shipperName}</h2>
                <p class="text-sm text-gray-400">${shipperId}</p>
            </div>
            <button id="back-to-shippers-list-btn" class="bg-gray-600 hover:bg-gray-500 text-white font-medium py-2.5 px-6 rounded-lg transition-colors duration-200 flex items-center space-x-2">
                <i data-lucide="arrow-left" class="w-5 h-5"></i>
                <span>Back to Shippers List</span>
            </button>
        </div>
        
        <div class="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full min-w-full divide-y divide-gray-700">
                    <thead class="bg-gray-700">
                        <tr>
                            <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Box No.</th>
                            <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Date Added</th>
                            <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Total Price</th>
                            <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-28">Actions</th> 
                        </tr>
                    </thead>
                    <tbody id="shipper-shipments-table-body" class="divide-y divide-gray-700">
                        <tr>
                            <td colspan="4" class="px-6 py-10 text-center text-gray-400">Loading shipper's entries...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    mainContent.innerHTML = html;
    if (window.lucide) {
       try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
    }

    const tableBody = document.getElementById('shipper-shipments-table-body');
    if (!db) {
        tableBody.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center text-red-400">Database not connected.</td></tr>`;
        return;
    }

    try {
        const entriesRef = collection(db, `artifacts/${appId}/public/data/shippers/${shipperId}/shipment_entries`);
        const q = query(entriesRef, orderBy("addedAt", "desc"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center text-gray-400">No shipment entries found for this shipper.</td></tr>`;
            return;
        }

        tableBody.innerHTML = '';
        snapshot.forEach(doc => {
            const entry = doc.data();
            const entryId = doc.id; 

            let date = 'N/A';
            if (entry.addedAt?.toDate) {
                date = entry.addedAt.toDate().toLocaleDateString('si-LK');
            } else if (entry.addedAt?.seconds) {
                 try { date = new Date(entry.addedAt.seconds * 1000).toLocaleDateString('si-LK'); } catch (e) {}
            }

            const row = `
                <tr class="hover:bg-gray-700 transition-colors duration-150">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${entry.boxNo || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${date}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-green-400">€ ${(entry.totalPrice || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-right space-x-2">
                        <button data-id="${entryId}" class="view-invoice-btn text-green-400 hover:text-green-300 p-1 inline-block" title="View Invoice">
                            <i data-lucide="eye" class="w-4 h-4 pointer-events-none"></i>
                        </button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
        if (window.lucide) {
           try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
        }

    } catch (error) {
        console.error(`Error loading shipments for shipper ${shipperId}: `, error);
        tableBody.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center text-red-400">Error loading data.</td></tr>`;
        customAlert('Error', `Failed to load shipper's entries: ${error.message}`);
    }
}

// This function REPLACES the old handlePriceChange
async function handleCbmPriceSave(e) {
    e.preventDefault();
    if (!db) return customAlert('Error', 'Database not connected.');
    
    const form = e.target;
    const messageDiv = document.getElementById('cbm-price-form-message');
    if (!form || !messageDiv) return;

    const priceName = form.cbmPriceName.value.trim();
    const priceValue = parseFloat(form.cbmPriceValue.value);

    if (!priceName || isNaN(priceValue) || priceValue < 0) {
        messageDiv.innerText = 'Please enter a valid price name and a positive price value.';
        messageDiv.className = 'mt-4 text-center text-red-400';
        return;
    }
    
    // Create a docId from the name
    const docId = priceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!docId) {
        messageDiv.innerText = 'Please enter a valid price name.';
        messageDiv.className = 'mt-4 text-center text-red-400';
        return;
    }

    try {
        const priceData = {
            name: priceName,
            price: priceValue
        };
        const priceDocRef = doc(db, `artifacts/${appId}/public/config/cbm_prices`, docId);
        await setDoc(priceDocRef, priceData);
        
        messageDiv.innerText = 'CBM price saved successfully!';
        messageDiv.className = 'mt-4 text-center text-green-400';
        form.reset();
        
        // Also update the legacy/default price doc just in case
        // This makes the *last saved price* the new default for fallbacks
        const legacyPriceDocRef = doc(db, `artifacts/${appId}/public/config/pricing/current`);
        await setDoc(legacyPriceDocRef, { pricePerCBM: priceValue }, { merge: true });
        legacyCBMPrice = priceValue; // Update global fallback

    } catch (error) {
        console.error("Error saving CBM price: ", error);
        messageDiv.innerText = 'Error saving CBM price.';
        messageDiv.className = 'mt-4 text-center text-red-400';
    }
    setTimeout(() => { if (messageDiv) messageDiv.innerText = ''; }, 3000);
}

// This function REPLACES the old loadCurrentPrice
async function loadCbmPrices() {
    console.log("[loadCbmPrices] Attempting to load CBM prices...");
    if (!db) {
        console.warn("[loadCbmPrices] DB not ready.");
        legacyCBMPrice = 0;
        return;
    }
    
    const listDiv = document.getElementById('saved-cbm-prices-list');
    const modalSelect = document.getElementById('cbm-price-select');

    // 1. Load the list of CBM prices from the new collection
    try {
        const pricesCollectionRef = collection(db, `artifacts/${appId}/public/config/cbm_prices`);
        const q = query(pricesCollectionRef);

        onSnapshot(q, (snapshot) => {
            console.log("[loadCbmPrices] Snapshot received for cbm_prices.");
            if (listDiv) listDiv.innerHTML = ''; // Clear list on changes page
            if (modalSelect) { // Clear and re-populate modal dropdown
                modalSelect.innerHTML = '<option value="">-- Select a price --</option>';
            }

            if (snapshot.empty) {
                if (listDiv) listDiv.innerHTML = `<p class="text-gray-400">No CBM prices saved yet.</p>`;
            }

            snapshot.forEach(doc => {
                const priceData = doc.data();
                const docId = doc.id;
                
                // 2a. Populate the list on the 'changes' page
                if (listDiv) {
                    const itemHTML = `
                        <div class="flex items-center justify-between bg-gray-700 p-4 rounded-lg">
                            <div>
                                <p class="font-medium text-white">${priceData.name || 'N/A'}</p>
                                <p class="text-sm text-green-400">€ ${priceData.price ? priceData.price.toFixed(2) : '0.00'}</p>
                            </div>
                            <button data-id="${docId}" class="delete-cbm-price-btn text-red-500 hover:text-red-400 p-1">
                                <i data-lucide="trash-2" class="w-5 h-5 pointer-events-none"></i>
                            </button>
                        </div>
                    `;
                    listDiv.innerHTML += itemHTML;
                }
                
                // 2b. Populate the dropdown in the 'add-box-modal'
                if (modalSelect && priceData.price > 0) {
                    const option = document.createElement('option');
                    option.value = priceData.price.toFixed(2);
                    option.text = `${priceData.name} (€ ${priceData.price.toFixed(2)})`;
                    modalSelect.appendChild(option);
                }
            });

            if (listDiv && window.lucide) {
                try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
            }
        }, (error) => {
            console.error("[loadCbmPrices] Error loading CBM prices: ", error);
            if (listDiv) listDiv.innerHTML = `<p class="text-red-400">Error loading CBM prices.</p>`;
        });

    } catch (error) {
        console.error("[loadCbmPrices] Snapshot setup failed: ", error);
    }

    // 3. Load the legacy "current" price for fallback compatibility
    try {
        const legacyPriceDocRef = doc(db, `artifacts/${appId}/public/config/pricing/current`);
        const docSnap = await getDoc(legacyPriceDocRef);
        if (docSnap.exists()) {
            const price = docSnap.data().pricePerCBM;
            legacyCBMPrice = (typeof price === 'number' && price >= 0) ? price : 0;
        } else {
            console.warn("[loadCbmPrices] Legacy pricing document does not exist. Fallback price is 0.");
            legacyCBMPrice = 0;
        }
    } catch (error) {
        legacyCBMPrice = 0;
        console.error("[loadCbmPrices] Error loading legacy/fallback price: ", error);
    }
    console.log("[loadCbmPrices] Global fallback (legacy) price set to:", legacyCBMPrice);
}

async function handleContainerChange(e) {
    e.preventDefault();
    if (!db) return customAlert('Error', 'Database not connected.');
    const form = e.target;
    const messageDiv = document.getElementById('container-form-message');
    if (!messageDiv) return;
    const containerName = form.containerName.value;
    const containerData = {
        name: containerName,
        length: parseFloat(form.containerLength.value),
        width: parseFloat(form.containerWidth.value),
        height: parseFloat(form.containerHeight.value)
    };
    const docId = containerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!docId) {
        messageDiv.innerText = 'Please enter a valid container name.';
        messageDiv.className = 'mt-4 text-center text-red-400';
        return;
    }
    try {
        const containerDocRef = doc(db, `artifacts/${appId}/public/config/containers`, docId);
        await setDoc(containerDocRef, containerData);
        messageDiv.innerText = 'Container saved successfully!';
        messageDiv.className = 'mt-4 text-center text-green-400';
        form.reset();
    } catch (error) {
        console.error("Error saving container: ", error);
        messageDiv.innerText = 'Error saving container.';
        messageDiv.className = 'mt-4 text-center text-red-400';
    }
    setTimeout(() => { if (messageDiv) messageDiv.innerText = ''; }, 3000);
}

function loadSavedContainers() {
    console.log("[loadSavedContainers] Attempting to load containers...");
    if (!db) {
        console.warn("[loadSavedContainers] DB not ready.");
        return;
    }
    const listDiv = document.getElementById('saved-containers-list');
    if (!listDiv) {
        console.warn("[loadSavedContainers] Element #saved-containers-list not found.");
        return;
    }

    const containersCollectionRef = collection(db, `artifacts/${appId}/public/config/containers`);
    const q = query(containersCollectionRef);

    onSnapshot(q, (snapshot) => {
        console.log("[loadSavedContainers] Snapshot received. Empty:", snapshot.empty);
        if (snapshot.empty) {
            listDiv.innerHTML = `<p class="text-gray-400">No container types saved yet.</p>`;
            return;
        }
        listDiv.innerHTML = '';
        snapshot.forEach(doc => {
            const container = doc.data();
            const docId = doc.id;
            console.log("[loadSavedContainers] Loading container:", docId, container);
            const itemHTML = `
                <div class="flex items-center justify-between bg-gray-700 p-4 rounded-lg">
                    <div>
                        <p class="font-medium text-white">${container.name || 'N/A'}</p>
                        <p class="text-sm text-gray-300">
                            ${container.length || 0}m (L) &times; ${container.width || 0}m (W) &times; ${container.height || 0}m (H)
                        </p>
                    </div>
                    <button data-id="${docId}" class="delete-container-btn text-red-500 hover:text-red-400 p-1"> <i data-lucide="trash-2" class="w-5 h-5 pointer-events-none"></i>
                    </button>
                </div>
            `;
            listDiv.innerHTML += itemHTML;
        });
        if (window.lucide) {
           try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
        }
    }, (error) => {
        console.error("[loadSavedContainers] Error loading containers: ", error);
        listDiv.innerHTML = `<p class="text-red-400">Error loading containers. Check Firestore rules or console.</p>`;
    });
}


async function handleDeleteContainer(docId) {
    if (!db) return customAlert('Error', 'Database not connected.');
    if (!confirm(`Are you sure you want to delete this container type (ID: ${docId})?`)) {
        return;
    }
    customAlert('Deleting', 'Deleting container...');
    try {
        const containerDocRef = doc(db, `artifacts/${appId}/public/config/containers`, docId);
        await deleteDoc(containerDocRef);
        customAlert('Success', 'Container deleted.');
    } catch (error) {
        console.error("Error deleting container: ", error);
        customAlert('Error', 'Failed to delete container.');
    }
}

// --- ADD THIS NEW FUNCTION BELOW ---
async function handleDeleteCbmPrice(docId) {
    if (!db) return customAlert('Error', 'Database not connected.');
    if (!confirm(`Are you sure you want to delete this CBM price (ID: ${docId})?`)) {
        return;
    }
    customAlert('Deleting', 'Deleting CBM price...');
    try {
        const priceDocRef = doc(db, `artifacts/${appId}/public/config/cbm_prices`, docId);
        await deleteDoc(priceDocRef);
        customAlert('Success', 'CBM price deleted.');
    } catch (error) {
        console.error("Error deleting CBM price: ", error);
        customAlert('Error', 'Failed to delete CBM price.');
    }
}

async function populateContainerDropdown() {
    const selectEl = document.getElementById('container-select-dropdown');
    if (!db || !selectEl) {
        console.warn("Container dropdown element not found.");
        return;
    }

    selectEl.innerHTML = '<option value="">-- Select a container --</option>'; 

    try {
        const containersCollectionRef = collection(db, `artifacts/${appId}/public/config/containers`);
        const q = query(containersCollectionRef);
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            selectEl.innerHTML = '<option value="" disabled>No containers saved. Go to Changes.</option>';
            return;
        }

        snapshot.forEach(doc => {
            const container = doc.data();
            const volume = (container.length || 0) * (container.width || 0) * (container.height || 0);
            if (volume > 0) {
                const option = document.createElement('option');
                option.value = volume.toFixed(4);
                option.text = `${container.name} (${volume.toFixed(2)} CBM)`;
                option.dataset.name = container.name;
                option.dataset.cbm = volume.toFixed(4);
                selectEl.appendChild(option);
            }
        });
    } catch (error) {
        console.error("Error loading containers for dropdown: ", error);
        selectEl.innerHTML = '<option value="" disabled>Error loading containers.</option>';
    }
}

function updateLoadingPlanUI() {
    const selectEl = document.getElementById('container-select-dropdown');
    const boxVolumeDisplay = document.getElementById('total-box-volume-display');
    const containerVolumeDisplay = document.getElementById('container-volume-display');
    const fillBar = document.getElementById('container-fill-bar');
    const fillPercent = document.getElementById('container-fill-percentage');

    if (!selectEl || !boxVolumeDisplay || !containerVolumeDisplay || !fillBar || !fillPercent) {
        return;
    }

    boxVolumeDisplay.innerText = currentTotalBoxCBM.toFixed(2);

    const selectedOption = selectEl.options[selectEl.selectedIndex];
    const containerCBM = parseFloat(selectedOption.dataset.cbm) || 0;

    if (containerCBM > 0) {
        containerVolumeDisplay.innerText = containerCBM.toFixed(2);

        const percentage = Math.min(100, (currentTotalBoxCBM / containerCBM) * 100);
        let displayPercent = percentage.toFixed(0);
        
        fillPercent.innerText = `${displayPercent}%`;
        fillBar.style.width = `${percentage.toFixed(2)}%`;

        if (percentage >= 100) {
            fillBar.classList.remove('bg-blue-600');
            fillBar.classList.add('bg-red-600');
            fillPercent.innerText = 'FULL';
        } else if (percentage > 85) {
            fillBar.classList.remove('bg-red-600');
            fillBar.classList.add('bg-blue-600'); 
        } else {
             fillBar.classList.remove('bg-red-600');
             fillBar.classList.add('bg-blue-600');
        }

    } else {
        containerVolumeDisplay.innerText = 'N/A';
        fillPercent.innerText = '0%';
        fillBar.style.width = '0%';
        fillBar.classList.remove('bg-red-600');
        fillBar.classList.add('bg-blue-600');
    }
}


async function handleGenerateSlipFromData(boxData, action = 'download', showPrice = true) {
    if (!boxData) return customAlert('Error', 'Cannot generate PDF. Invalid data.');

    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF !== 'function' || typeof (new window.jspdf.jsPDF()).autoTable !== 'function') {
        customAlert('Error', 'PDF libraries not loaded correctly. Check index.html.');
        return;
    }

    let doc;
    try {
        doc = new window.jspdf.jsPDF();
    } catch (e) {
         customAlert('Error', `Could not create PDF object: ${e.message}.`);
         return;
    }

    const alertModal = document.getElementById('custom-alert-modal');
    if (alertModal && alertModal.querySelector('#custom-alert-title')?.innerText.includes('Generating')) {
         alertModal.style.display = 'none';
    }
    customAlert('Generating PDF...', 'Please wait, building slip...');

    // Get the price that was used when saving this entry
    // Fallback to the legacy global price if it wasn't saved
    const priceToUse = (boxData.cbmPriceUsed !== undefined) ? boxData.cbmPriceUsed : legacyCBMPrice;

    try {
        
        const logoImg = document.getElementById('invoice-logo');
        if (logoImg) {
            try {
                doc.addImage(logoImg, 'JPEG', 14, 15, 50, 20); 
            } catch (e) {
                console.error("PDF Logo Error: ", e);
                doc.text('Ravi Cargo', 20, 25); 
            }
        } else {
            console.warn("invoice-logo element not found");
            doc.text('Ravi Cargo', 20, 25); 
        }
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.text('INVOICE', 105, 22, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        
        doc.text('Email: info@ravicargo.com', 14, 41); 
        doc.text('Phone: 324 093 4495', 14, 47); 

        doc.setFont('helvetica', 'bold');
        doc.text('Box No (Manual ID):', 140, 35);
        doc.text('Date Added:', 140, 41);
        
        doc.setFont('helvetica', 'normal');
        let addedDate = 'N/A';
        if (boxData.addedAt?.toDate) {
            addedDate = boxData.addedAt.toDate().toLocaleDateString('si-LK');
        } else if (boxData.addedAt?.seconds) {
             addedDate = new Date(boxData.addedAt.seconds * 1000).toLocaleDateString('si-LK');
        } else if (boxData.addedAt && typeof boxData.addedAt === 'string') {
             try { addedDate = new Date(boxData.addedAt).toLocaleDateString('si-LK'); } catch(e) {}
        }
        
        doc.text(boxData.boxNo || 'N/A', 180, 35);
        doc.text(addedDate, 180, 41);

        doc.setLineWidth(0.5);
        doc.line(20, 55, 190, 55);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('SHIPPER (Bill To):', 20, 65);
        doc.text('RECEIVER (Ship To):', 110, 65);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(boxData.shipperName || '', 20, 71);
        doc.text(boxData.shipperEmail || '', 20, 77);
        doc.text(boxData.shipperCity || '', 20, 83);

        doc.text(boxData.receiverName || '', 110, 71);
        doc.text(boxData.receiverPhone || '', 110, 77);
        const receiverAddressLines = doc.splitTextToSize(boxData.receiverAddress || '', 80);
        doc.text(receiverAddressLines, 110, 83);
        
        const tableColumn = ["Item Description", "Dimensions (L x W x H)"];
        if (showPrice) {
            tableColumn.push("Calculated Price (€)");
        }
        const tableRows = [];

        if (boxData.boxes && boxData.boxes.length > 0) {
            boxData.boxes.forEach((box, index) => {
                const boxRow = [
                    `Box ${index + 1}`,
                    `${box.length || 0}cm x ${box.width || 0}cm x ${box.height || 0}cm`
                ];
                if (showPrice) {
                    let calculatedBoxPrice = 0;
                    // Use the saved price (priceToUse)
                    if (box.length > 0 && box.width > 0 && box.height > 0 && priceToUse > 0) {
                        const lengthM = box.length / 100;
                        const widthM = box.width / 100;
                        const heightM = box.height / 100;
                        const volumeCBM = lengthM * widthM * heightM;
                        calculatedBoxPrice = volumeCBM * priceToUse; // <-- Uses priceToUse
                    }
                    boxRow.push(`€ ${calculatedBoxPrice.toFixed(2)}`);
                }
                tableRows.push(boxRow);
            });
        }

        if (boxData.otherObjects && boxData.otherObjects.length > 0) {
            boxData.otherObjects.forEach(obj => {
                const objectRow = [
                    obj.name || 'Unnamed Object',
                    'N/A'
                ];
                if (showPrice) {
                    objectRow.push(`€ ${(obj.price || 0).toFixed(2)}`);
                }
                tableRows.push(objectRow);
            });
        }
        
        doc.autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: Math.max(90, doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 90),
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185] },
        });

        const finalY = doc.lastAutoTable.finalY || 150;
        let notesY = finalY + 15;

        if (showPrice) {
            const subtotal = boxData.subtotalPrice !== undefined ? boxData.subtotalPrice : boxData.totalCalculatedPrice;
            const discount = boxData.discountAmount || 0;
            const total = boxData.totalCalculatedPrice !== undefined ? boxData.totalCalculatedPrice : 0;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(12);
            doc.text(`Subtotal:`, 150, notesY, { align: 'right' });
            doc.text(`€ ${subtotal.toFixed(2)}`, 185, notesY, { align: 'right' });
            
            notesY += 7; 
            
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(12);
            doc.text(`Discount:`, 150, notesY, { align: 'right' });
            doc.text(`- € ${discount.toFixed(2)}`, 185, notesY, { align: 'right' });

            notesY += 7; 

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.text(`FINAL TOTAL:`, 150, notesY, { align: 'right' });
            doc.text(`€ ${total.toFixed(2)}`, 185, notesY, { align: 'right' });
            
            notesY += 15; 
        }
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('Payment Status:', 20, notesY);
        doc.text('Status:', 20, notesY + 6);
        if (boxData.paymentStatus === 'Unpaid') {
            doc.text('Expected Paying Date:', 20, notesY + 12);
        }
        
        doc.setFont('helvetica', 'normal');
        doc.text(boxData.paymentStatus || 'N/A', 65, notesY + 6);
        if (boxData.paymentStatus === 'Unpaid') {
             doc.text(boxData.payingDate || 'N/A', 65, notesY + 12);
        }
        
        if (boxData.notes) {
            notesY += 25; 
            doc.setFont('helvetica', 'bold');
            doc.text('Notes:', 20, notesY);
            doc.setFont('helvetica', 'normal');
            const notesLines = doc.splitTextToSize(boxData.notes, 170);
            doc.text(notesLines, 20, notesY + 6);
        }

        const alertModalGen = document.getElementById('custom-alert-modal');
        if (alertModalGen) alertModalGen.style.display = 'none';

        const fileName = showPrice ? `Invoice-${boxData.boxNo || 'slip'}.pdf` : `Slip-NoPrice-${boxData.boxNo || 'slip'}.pdf`;
        if (action === 'view') {
            doc.output('dataurlnewwindow');
        } else {
            doc.save(fileName);
        }

    } catch (error) {
        console.error("Error generating PDF content or saving: ", error);
        const alertModalGen = document.getElementById('custom-alert-modal');
        if (alertModalGen && alertModalGen.style.display !== 'none' && alertModalGen.querySelector('#custom-alert-title')?.innerText.includes('Generating')) {
             alertModalGen.style.display = 'none';
        }
        customAlert('Error', `Failed to generate PDF: ${error.message}. Check console.`);
    }
}

async function handleGenerateInvoice(docId, action = 'download', showPrice = true) {
    if (!db || !docId) return customAlert('Error', 'Cannot generate PDF. Invalid ID.');

    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF !== 'function' || typeof (new window.jspdf.jsPDF()).autoTable !== 'function') {
        customAlert('Error', 'PDF libraries not loaded correctly. Check index.html.');
        return;
    }
    
    customAlert('Generating PDF...', 'Fetching entry data...');

    try {
        const boxDocRef = doc(db, `artifacts/${appId}/public/data/boxes`, docId);
        const docSnap = await getDoc(boxDocRef);

        if (!docSnap.exists()) {
             const alertModalGen = document.getElementById('custom-alert-modal');
             if (alertModalGen) alertModalGen.style.display = 'none';
            customAlert('Error', 'Entry not found.');
            return;
        }

        const boxData = docSnap.data();
        
        await handleGenerateSlipFromData(boxData, action, showPrice);

    } catch (error) {
        console.error("Error fetching doc for PDF: ", error);
        const alertModalGen = document.getElementById('custom-alert-modal');
        if (alertModalGen && alertModalGen.style.display !== 'none' && alertModalGen.querySelector('#custom-alert-title')?.innerText.includes('Generating')) {
             alertModalGen.style.display = 'none';
        }
        customAlert('Error', `Failed to fetch data for PDF: ${error.message}.`);
    }
}

function loadBoxesTable() {
     if (!db) return;
    const tableBody = document.getElementById('boxes-table-body');
    if (!tableBody) return;

    const boxesCollectionRef = collection(db, `artifacts/${appId}/public/data/boxes`);
    const q = query(boxesCollectionRef, orderBy("addedAt", "desc"));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="8" class="px-6 py-10 text-center text-gray-400">No entries added yet.</td></tr>`;
            
            currentTotalBoxCBM = 0; 
            updateLoadingPlanUI(); 
            return;
        }

        tableBody.innerHTML = '';
        
        let calculatedCBM = 0; 

        snapshot.forEach(doc => {
            const box = doc.data();
            const docId = doc.id;

            if (box.boxes && Array.isArray(box.boxes)) {
                box.boxes.forEach(b => {
                    const lengthM = (b.length || 0) / 100;
                    const widthM = (b.width || 0) / 100;
                    const heightM = (b.height || 0) / 100;
                    if (lengthM > 0 && widthM > 0 && heightM > 0) {
                        calculatedCBM += (lengthM * widthM * heightM);
                    }
                });
            }

            let date = 'N/A';
             if (box.addedAt?.toDate) {
                 date = box.addedAt.toDate().toLocaleDateString('si-LK');
             } else if (box.addedAt instanceof Date) {
                 date = box.addedAt.toLocaleDateString('si-LK');
             } else if (box.addedAt && typeof box.addedAt.seconds === 'number') {
                  try { date = new Date(box.addedAt.seconds * 1000).toLocaleDateString('si-LK'); } catch (e) { console.warn("Could not format date:", box.addedAt)}
             } else if (typeof box.addedAt === 'string') {
                 try { date = new Date(box.addedAt).toLocaleDateString('si-LK'); } catch(e) {}
             }


            const row = `
                <tr class="hover:bg-gray-700 transition-colors duration-150 cursor-pointer box-table-row" data-id="${docId}">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white view-details-trigger" title="Firestore ID: ${docId}">${box.boxNo || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 view-details-trigger">${box.shipperName || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 view-details-trigger">${box.receiverName || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 view-details-trigger">${box.quantity || 0}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 view-details-trigger">${date}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 view-details-trigger">${box.paymentStatus || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 view-details-trigger">${box.payingDate || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-right space-x-2 action-cell">
                        <button data-id="${docId}" class="view-invoice-btn text-green-400 hover:text-green-300 p-1 inline-block" title="View Invoice">
                            <i data-lucide="eye" class="w-4 h-4 pointer-events-none"></i>
                        </button>
                        <button data-id="${docId}" class="download-invoice-btn text-purple-400 hover:text-purple-300 p-1 inline-block" title="Download Invoice">
                            <i data-lucide="download" class="w-4 h-4 pointer-events-none"></i>
                        </button>
                        <button data-id="${docId}" class="edit-box-btn text-blue-400 hover:text-blue-300 p-1 inline-block" title="Edit Entry">
                            <i data-lucide="edit-2" class="w-4 h-4 pointer-events-none"></i>
                        </button>
                        <button data-id="${docId}" class="delete-box-btn text-red-500 hover:text-red-400 p-1 inline-block" title="Delete Entry">
                            <i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i>
                        </button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
        
        currentTotalBoxCBM = calculatedCBM;
        updateLoadingPlanUI(); 

        if (window.lucide) {
           try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
        }
        filterBoxesTable();
    }, (error) => {
        console.error("Error loading boxes: ", error);
        tableBody.innerHTML = `<tr><td colspan="8" class="px-6 py-10 text-center text-red-400">Error loading data. Check console and Firestore rules.</td></tr>`;
        
        currentTotalBoxCBM = 0;
        updateLoadingPlanUI();
    });
 }
 
async function handleDeleteBox(docId) {
    if (!db) return customAlert('Error', 'Database not connected.');

    customAlert('Confirm Deletion', `Really delete entry ID ${docId.substring(0,6)}...? This is permanent!`, () => {
         if (!confirm(`Are you sure you want to delete this entry (ID: ${docId.substring(0,6)}...)? This cannot be undone.`)) {
             return;
         }

         customAlert('Deleting', 'Deleting entry...');

         getDoc(doc(db, `artifacts/${appId}/public/data/boxes`, docId)).then(boxDoc => {
             const boxData = boxDoc.exists() ? boxDoc.data() : null;

             deleteDoc(doc(db, `artifacts/${appId}/public/data/boxes`, docId)).then(() => {
                 customAlert('Success', 'Entry deleted.');

                 if (boxData && boxData.shipperEmail) {
                     const shipperId = boxData.shipperEmail;
                     const shipperRef = doc(db, `artifacts/${appId}/public/data/shippers`, shipperId);
                     
                     setDoc(shipperRef, { shipmentCount: increment(-1) }, { merge: true })
                         .then(() => console.log("Decremented shipper count for:", shipperId))
                         .catch(err => console.error("Error decrementing shipper count:", err));

                    const shipperBoxRef = doc(db, `artifacts/${appId}/public/data/shippers/${shipperId}/shipment_entries`, docId);
                    deleteDoc(shipperBoxRef)
                        .then(() => console.log("Deleted shipment_entry reference:", docId))
                        .catch(err => console.error("Error deleting shipment_entry reference:", err));
                 }

             }).catch(error => {
                 console.error("Error deleting box document: ", error);
                 customAlert('Error', 'Failed to delete entry document.');
             });

         }).catch(error => {
              console.error("Error fetching box before delete (shipper count not decremented): ", error);
              customAlert('Error', 'Failed to fetch entry before deleting.');
         });
    });
}

function filterBoxesTable() {
    const nameFilterInput = document.getElementById('filterCustomerName');
    const boxNoFilterInput = document.getElementById('filterBoxNo');
    const dateFilterInput = document.getElementById('filterDate');
    const statusFilterInput = document.getElementById('filterPaymentStatus');
    const payingDateFilterInput = document.getElementById('filterPayingDate');

    const nameFilter = nameFilterInput ? nameFilterInput.value.toLowerCase() : '';
    const boxNoFilter = boxNoFilterInput ? boxNoFilterInput.value.toLowerCase() : '';
    const dateFilter = dateFilterInput ? dateFilterInput.value : '';
    const statusFilter = statusFilterInput ? statusFilterInput.value : 'All';
    const payingDateFilter = payingDateFilterInput ? payingDateFilterInput.value : '';

    const tableBody = document.getElementById('boxes-table-body');
    if (!tableBody) return;
    const rows = tableBody.getElementsByTagName('tr');
    let hasVisibleRows = false;
    let snapshot = null;

    for (const row of rows) {
        if (row.cells.length < 8 || row.closest('thead')) continue;

        const boxNoCell = row.cells[0];
        const shipperCell = row.cells[1];
        const dateCell = row.cells[4];
        const statusCell = row.cells[5];
        const payingDateCell = row.cells[6];
        if (!boxNoCell || !shipperCell || !dateCell || !statusCell || !payingDateCell) continue;

        const boxNo = boxNoCell.innerText.toLowerCase();
        const shipper = shipperCell.innerText.toLowerCase();
        const date = dateCell.innerText;
        const status = statusCell.innerText;
        const payingDate = payingDateCell.innerText;

        let formattedDate = '';
        if (date && date !== 'N/A' && date !== 'Invalid Date') {
            const parts = date.split('/');
            if(parts.length === 3) {
                 formattedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            }
        }
        const nameMatch = shipper.includes(nameFilter);
        const boxNoMatch = boxNo.includes(boxNoFilter);
        const dateMatch = (dateFilter === '') || (formattedDate === dateFilter);
        const statusMatch = (statusFilter === 'All') || (status.toLowerCase() === statusFilter.toLowerCase());
        const payingDateMatch = (payingDateFilter === '') || (payingDate === payingDateFilter);

        if (nameMatch && boxNoMatch && dateMatch && statusMatch && payingDateMatch) {
            row.style.display = '';
            hasVisibleRows = true;
        } else {
            row.style.display = 'none';
        }
    }
     const noResultsRow = tableBody.querySelector('.no-results-row');
     
     const dataRowsPresent = Array.from(rows).some(row => !row.classList.contains('no-results-row') && !row.closest('thead'));

     if (!hasVisibleRows && dataRowsPresent) {
         if (!noResultsRow) {
             const tr = document.createElement('tr');
             tr.className = 'no-results-row';
             tr.innerHTML = `<td colspan="8" class="px-6 py-10 text-center text-gray-400">No matching entries found.</td>`;
             tableBody.appendChild(tr);
         } else {
             noResultsRow.style.display = '';
         }
     } else if (noResultsRow) {
         noResultsRow.style.display = 'none';
     }
}


const handleEndAllEntries = async () => {
    if (!db) return customAlert('Error', 'Database not connected.');

    const shipmentName = prompt('Please enter a name for this new shipment batch:', '');
    if (!shipmentName) {
        customAlert('Cancelled', 'Ending entries was cancelled.');
        return;
    }

    if (!confirm(`Are you sure you want to end all active entries and move them to a new shipment named "${shipmentName}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    customAlert('Processing...', 'Moving all active entries to a new shipment...');
    const alertModal = document.getElementById('custom-alert-modal');

    try {
        const boxesCollectionRef = collection(db, `artifacts/${appId}/public/data/boxes`);
        const snapshot = await getDocs(boxesCollectionRef);

        if (snapshot.empty) {
            if (alertModal) alertModal.style.display = 'none';
            customAlert('No Entries', 'There are no active entries to move.');
            return;
        }

        const allEntriesData = [];
        let totalShipmentPrice = 0;
        let entryCount = 0;
        const batch = writeBatch(db);

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const docRef = docSnap.ref;

            allEntriesData.push(data);
            totalShipmentPrice += data.totalCalculatedPrice || 0;
            entryCount++;
            batch.delete(docRef);
        });

        const newShipmentData = {
            shipmentName: shipmentName, // <-- MEKAI ADD KALE
            endedAt: Timestamp.fromDate(new Date()),
            status: 'pending',
            totalPrice: totalShipmentPrice,
            entryCount: entryCount,
            entries: allEntriesData
        };

        const newShipmentRef = doc(collection(db, `artifacts/${appId}/public/data/shipments`));
        batch.set(newShipmentRef, newShipmentData);

        await batch.commit();
        
        try {
            const newShipmentId = newShipmentRef.id;
            const incomeData = {
                type: "Income",
                date: Timestamp.fromDate(new Date()),
                description: `Shipment Batch - ${shipmentName}`, // <-- MEKATH WENAS KALA
                category: "Shipment",
                amount: totalShipmentPrice,
                paymentMethod: "N/A",
                addedBy: userId || 'unknown'
            };
            await addDoc(collection(db, `artifacts/${appId}/public/data/transactions`), incomeData);
            console.log("Shipment income transaction added successfully.");
        } catch (incomeError) {
            console.error("Failed to add shipment income transaction: ", incomeError);
            customAlert('Warning', 'Shipment was moved, but failed to auto-add income entry. Please add it manually.');
        }

        if (alertModal) alertModal.style.display = 'none';
        customAlert('Success', `Successfully moved ${entryCount} entries to a new shipment named "${shipmentName}".`);

    } catch (error) {
        console.error("Error ending all entries: ", error);
        if (alertModal) alertModal.style.display = 'none';
        customAlert('Error', `Failed to move entries: ${error.message}`);
    }
};

function loadPastShipments() {
    if (!db) return;
    const tableBody = document.getElementById('past-shipments-table-body');
    if (!tableBody) return;

    const shipmentsCollectionRef = collection(db, `artifacts/${appId}/public/data/shipments`);
    const q = query(shipmentsCollectionRef, orderBy("endedAt", "desc"));

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-gray-400">No past shipments found.</td></tr>`;
            return;
        }

        tableBody.innerHTML = '';
        snapshot.forEach(docSnap => {
            const shipment = docSnap.data();
            const shipmentId = docSnap.id;
            
            // <-- ME DEKA ADD KALE
            const shipmentName = shipment.shipmentName || `Shipment ${shipmentId.substring(0, 6)}...`;

            let date = 'N/A';
            if (shipment.endedAt?.toDate) {
                date = shipment.endedAt.toDate().toLocaleString('si-LK', { dateStyle: 'short', timeStyle: 'short' });
            }

            const status = shipment.status || 'pending';

            const statusDropdown = `
                <select data-id="${shipmentId}" class="shipment-status-select w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="shipped" ${status === 'shipped' ? 'selected' : ''}>Shipped</option>
                    <option value="delivered" ${status === 'delivered' ? 'selected' : ''}>Delivered</option>
                </select>
            `;

            const row = `
                <tr class="hover:bg-gray-700 transition-colors duration-150">
                    
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white shipment-details-trigger cursor-pointer" data-id="${shipmentId}">
                        ${shipmentName}
                        <span class="block text-xs text-gray-400">${date}</span>
                    </td>
                    
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${statusDropdown}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 shipment-details-trigger cursor-pointer" data-id="${shipmentId}">${shipment.entryCount || 0}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300 shipment-details-trigger cursor-pointer" data-id="${shipmentId}">€ ${(shipment.totalPrice || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-right space-x-2">
                        <button data-id="${shipmentId}" class="view-shipment-details-btn text-blue-400 hover:text-blue-300 p-1 inline-block" title="View Details">
                            <i data-lucide="eye" class="w-5 h-5 pointer-events-none"></i>
                        </button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });
        if (window.lucide) {
           try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
        }
    }, (error) => {
        console.error("Error loading past shipments: ", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-red-400">Error loading data.</td></tr>`;
    });
}

const updateShipmentStatus = async (shipmentId, newStatus) => {
    if (!db || !shipmentId || !newStatus) return;
    
    const docRef = doc(db, `artifacts/${appId}/public/data/shipments`, shipmentId);
    try {
        await setDoc(docRef, { status: newStatus }, { merge: true });
        console.log(`Shipment ${shipmentId} status updated to ${newStatus}`);
    } catch (error) {
        console.error("Error updating shipment status: ", error);
        customAlert('Error', `Failed to update status: ${error.message}`);
    }
};

const handleViewShipmentDetails = async (shipmentId) => {
    if (!db || !shipmentId) return customAlert('Error', 'Invalid Shipment ID.');
    
    customAlert('Loading...', 'Loading shipment details...');
    const alertModal = document.getElementById('custom-alert-modal');

    try {
        const docRef = doc(db, `artifacts/${appId}/public/data/shipments`, shipmentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            renderShipmentDetails(docSnap.data(), shipmentId);
            
            if (window.setupShipmentPDF) {
                window.setupShipmentPDF(shipmentId, docSnap.data());
            } else {
                console.error("setupShipmentPDF function not found on window object!");
                customAlert('Error', 'PDF generation function (setupShipmentPDF) is missing from index.html.');
            }

            if (alertModal) alertModal.style.display = 'none';
        } else {
            if (alertModal) alertModal.style.display = 'none';
            customAlert('Error', 'Shipment not found.');
            loadContent('past-shipments');
        }
    } catch (error) {
        console.error("Error fetching shipment details: ", error);
        if (alertModal) alertModal.style.display = 'none';
        customAlert('Error', `Failed to load details: ${error.message}`);
    }
};


function renderShipmentDetails(shipment, shipmentId) {
    if (!mainContent) return;

    let date = 'N/A';
    if (shipment.endedAt?.toDate) {
        date = shipment.endedAt.toDate().toLocaleString('si-LK', { dateStyle: 'full', timeStyle: 'short' });
    }

    let entriesTableRows = '';
    if (shipment.entries && shipment.entries.length > 0) {
        shipment.entries.forEach((entry, index) => {
            entriesTableRows += `
                <tr class="hover:bg-gray-700 transition-colors duration-150 shipment-entry-row">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${entry.boxNo || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${entry.shipperName || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${entry.receiverName || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${entry.quantity || 0}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">€ ${(entry.totalCalculatedPrice || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-right space-x-2">
                        
                        <button class="edit-past-entry-btn text-blue-400 hover:text-blue-300 p-1" data-shipment-id="${shipmentId}" data-entry-index="${index}" title="Edit Entry">
                           <i data-lucide="edit-2" class="w-5 h-5 pointer-events-none"></i>
                        </button>
                        
                        <button class="view-entry-details-btn text-blue-400 hover:text-blue-300 p-1" data-shipment-id="${shipmentId}" data-entry-index="${index}" title="View Entry Details">
                           <i data-lucide="eye" class="w-5 h-5 pointer-events-none"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    } else {
        entriesTableRows = `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400">This shipment contains no entries.</td></tr>`;
    }

    // ALUTH FILTER BAR HTML EKA
    const filterBarHtml = `
        <div class="bg-gray-800 p-6 rounded-lg shadow-lg mb-6 mt-6">
            <h3 class="text-lg font-semibold mb-4 text-gray-300">Filter Entries</h3>
            <div class="grid grid-cols-1 md:grid-cols-6 gap-4 md:items-end">
                <div>
                    <label for="filter-shipment-shipperName" class="block text-sm font-medium text-gray-400 mb-1">Search by Shipper</label>
                    <input type="text" id="filter-shipment-shipperName" placeholder="Enter shipper name..." class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label for="filter-shipment-boxNo" class="block text-sm font-medium text-gray-400 mb-1">Search by Box No</label>
                    <input type="text" id="filter-shipment-boxNo" placeholder="Enter manual box no..." class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label for="filter-shipment-paymentStatus" class="block text-sm font-medium text-gray-400 mb-1">Payment Status</label>
                    <select id="filter-shipment-paymentStatus" class="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="All">All</option>
                        <option value="Paid">Paid</option>
                        <option value="Unpaid">Unpaid</option>
                    </select>
                </div>
                <div class="md:col-span-2"></div>
                <div>
                    <button id="filter-shipment-clear-btn" class="w-full bg-gray-600 hover:bg-gray-500 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors duration-200">
                        Clear
                    </button>
                </div>
            </div>
        </div>
    `;

    const html = `
        <div class="flex justify-between items-center mb-6">
            <h1 class="text-3xl font-bold">Shipment: ${shipment.shipmentName || 'Details'}</h1>
            
            <div class="flex items-center gap-4">
                <button id="download-shipment-pdf-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-lg transition-colors duration-200 flex items-center space-x-2">
                    <i data-lucide="download" class="w-5 h-5"></i>
                    <span>Download PDF</span>
                </button>
                <button id="back-to-shipments-btn" class="bg-gray-600 hover:bg-gray-500 text-white font-medium py-2.5 px-6 rounded-lg transition-colors duration-200 flex items-center space-x-2">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                    <span>Back to Shipments List</span>
                </button>
            </div>
            </div>

        <div id="shipment-details-content-wrapper">

            <div class="bg-gray-800 p-6 rounded-lg shadow-lg mb-6">
                <h2 class="text-xl font-semibold mb-4 text-blue-300">Shipment Summary</h2>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                    <div><strong class="text-gray-400">Ended Date:</strong> <span class="text-white">${date}</span></div>
                    <div><strong class="text-gray-400">Status:</strong> <span class="text-white capitalize">${shipment.status || 'N/A'}</span></div>
                    <div><strong class="text-gray-400">Entry Count:</strong> <span class="text-white">${shipment.entryCount || 0}</span></div>
                    <div><strong class="text-gray-400">Total Price:</strong> <span class="text-green-400 font-bold text-base">€ ${(shipment.totalPrice || 0).toFixed(2)}</span></div>
                </div>
            </div>

            ${filterBarHtml}

            <div class="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
                <h3 class="text-lg font-semibold p-6 text-gray-300">Entries in this Shipment</h3>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-full divide-y divide-gray-700">
                        <thead class="bg-gray-700">
                            <tr>
                                <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Box No.</th>
                                <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Shipper</th>
                                <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Receiver</th>
                                <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Qty</th>
                                <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Price</th>
                                <th scope="col" class="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-28">Actions</th> 
                            </tr>
                        </thead>
                        <tbody id="shipment-entries-table-body" class="divide-y divide-gray-700">
                            ${entriesTableRows}
                        </tbody>
                    </table>
                </div>
            </div>

        </div> `;

    mainContent.innerHTML = html;
    if (window.lucide) {
       try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
    }
}


document.addEventListener('DOMContentLoaded', async () => {

    console.log("DOM Content Loaded. Initializing...");

    loginContainer = document.getElementById('login-container');
    appContainer = document.getElementById('app-container');
    mainContent = document.getElementById('main-content');

     if (!loginContainer || !appContainer || !mainContent) {
         console.error("CRITICAL: Main layout containers (login, app, main-content) not found in index.html!");
         document.body.innerHTML = '<h1 style="color: red; text-align: center; margin-top: 50px;">Layout Error: Could not find essential page elements.</h1>';
         return;
     }


    document.getElementById('custom-alert-close')?.addEventListener('click', () => {
        const modal = document.getElementById('custom-alert-modal');
        if (modal) modal.style.display = 'none';
    });

    initializeNavigation();
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

    document.getElementById('add-box-form')?.addEventListener('submit', handleAddBox);
    document.getElementById('add-box-modal-close-btn')?.addEventListener('click', closeAddBoxModal);

    document.getElementById('add-box-modal')?.addEventListener('click', (e) => {
        if(e.target === e.currentTarget) {
            closeAddBoxModal();
            return;
        }
        const removeObjBtn = e.target.closest('.remove-object-btn');
        if (removeObjBtn) {
            removeObjBtn.closest('.object-row')?.remove();
            calculateTotalPrice();
            return;
        }
        const removeBoxBtn = e.target.closest('.remove-box-btn');
        if (removeBoxBtn) {
             removeBoxBtn.closest('.box-row')?.remove();
             document.querySelectorAll('#box-details-list .box-row:not([style*="display: none"])').forEach((remainingRow, idx) => {
                 const numSpan = remainingRow.querySelector('.box-number');
                 if (numSpan) numSpan.innerText = idx + 1;
             });
             calculateTotalPrice();
             return;
        }
    });
     document.getElementById('add-box-modal')?.addEventListener('input', (e) => {
         if (e.target && (e.target.matches('.box-dimension') || e.target.matches('.object-price') || e.target.id === 'discountPrice')) {
             calculateTotalPrice();
         }
         if (e.target && e.target.id === 'paymentStatus') {
             togglePayingDate();
         }
         // Note: The 'cbm-price-select' change listener is added in openAddBoxModal
     });


    document.getElementById('view-details-modal-close-btn')?.addEventListener('click', closeViewDetailsModal);
    document.getElementById('view-details-modal-close-btn-bottom')?.addEventListener('click', closeViewDetailsModal);
    document.getElementById('view-details-modal')?.addEventListener('click', (e) => {
         if(e.target.id === 'view-details-modal') closeViewDetailsModal();
    });

    document.getElementById('download-slip-pdf-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const modal = document.getElementById('view-details-modal');
        const docId = modal.dataset.currentDocId;
        const dataString = modal.dataset.currentData;
        
        if (docId) {
            console.log("Modal Download Slip (Price) clicked for docId:", docId);
            handleGenerateInvoice(docId, 'download', true);
        } else if (dataString) {
            console.log("Modal Download Slip (Price) clicked with embedded data.");
            try {
                const entryData = JSON.parse(dataString);
                handleGenerateSlipFromData(entryData, 'download', true); 
            } catch (err) {
                console.error("Failed to parse entry data from modal:", err);
                customAlert('Error', 'Could not read entry data to generate slip.');
            }
        } else {
            console.error("Could not find docId OR data on modal dataset.");
            customAlert('Error', 'Could not find the entry ID or data to download.');
        }
    });

    document.getElementById('download-slip-no-price-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const modal = document.getElementById('view-details-modal');
        const docId = modal.dataset.currentDocId;
        const dataString = modal.dataset.currentData;
        
        if (docId) {
            console.log("Modal Download Slip (No Price) clicked for docId:", docId);
            handleGenerateInvoice(docId, 'download', false); 
        } else if (dataString) {
            console.log("Modal Download Slip (No Price) clicked with embedded data.");
            try {
                const entryData = JSON.parse(dataString);
                handleGenerateSlipFromData(entryData, 'download', false); 
            } catch (err) {
                console.error("Failed to parse entry data from modal:", err);
                customAlert('Error', 'Could not read entry data to generate slip.');
            }
        } else {
            console.error("Could not find docId OR data on modal dataset.");
            customAlert('Error', 'Could not find the entry ID or data to download.');
        }
    });

    document.getElementById('add-transaction-modal-close-btn')?.addEventListener('click', closeAddTransactionModal);
    document.getElementById('add-transaction-form')?.addEventListener('submit', handleAddTransaction);


    if (mainContent) {
        mainContent.addEventListener('submit', (e) => {
            if (e.target.id === 'cbm-price-form') { // <-- New form ID
                e.preventDefault();
                handleCbmPriceSave(e); // <-- New function
            } else if (e.target.id === 'container-change-form') {
                 e.preventDefault();
                handleContainerChange(e);
            }
        });

        mainContent.addEventListener('click', async (e) => {
            const target = e.target;
            const currentTarget = e.currentTarget;

            const viewShipperShipmentsBtn = target.closest('.view-shipper-shipments');
            const backToShippersBtn = target.closest('#back-to-shippers-list-btn');

            const deleteContainerBtn = target.closest('.delete-container-btn');
            const deleteCbmPriceBtn = target.closest('.delete-cbm-price-btn'); // <-- New button
            
            const viewInvoiceBtn = target.closest('.view-invoice-btn');
            const downloadInvoiceBtn = target.closest('.download-invoice-btn');

            const deleteBoxBtn = target.closest('.delete-box-btn');
            const editBoxBtn = target.closest('.edit-box-btn');
            const viewDetailsTrigger = target.closest('.view-details-trigger');
            
            const backToShipmentsBtn = target.closest('#back-to-shipments-btn');
            const viewShipmentDetailsBtn = target.closest('.view-shipment-details-btn');
            const shipmentDetailsTrigger = target.closest('.shipment-details-trigger');
            
            // --- ME DEKA ALUTHIN ADD KALE ---
            const viewEntryDetailsBtn = target.closest('.view-entry-details-btn');
            const editPastEntryBtn = target.closest('.edit-past-entry-btn');
            const clearShipmentFilterBtn = target.closest('#filter-shipment-clear-btn');
            // --- IWARAI ---


            if (viewShipperShipmentsBtn) {
                 e.preventDefault(); e.stopPropagation();
                 const shipperId = viewShipperShipmentsBtn.dataset.id;
                 const shipperName = viewShipperShipmentsBtn.dataset.name;
                 if (shipperId) {
                     loadShipperShipmentsPage(shipperId, shipperName);
                 }
                 return;
             }
             if (backToShippersBtn) {
                e.preventDefault(); e.stopPropagation();
                loadContent('shippers-database');
                return;
            }


            if (deleteContainerBtn) {
                e.preventDefault(); e.stopPropagation();
                const docId = deleteContainerBtn.dataset.id;
                if(docId) handleDeleteContainer(docId);
                return;
            }

            // --- New block for deleting a CBM price ---
            if (deleteCbmPriceBtn) {
                e.preventDefault(); e.stopPropagation();
                const docId = deleteCbmPriceBtn.dataset.id;
                if(docId) handleDeleteCbmPrice(docId); // <-- New function
                return;
            }
            // --- End of new block ---

            if (viewInvoiceBtn) {
                e.preventDefault(); e.stopPropagation();
                const docId = viewInvoiceBtn.dataset.id;
                if(docId) handleGenerateInvoice(docId, 'view', true);
                return;
            }
            if (downloadInvoiceBtn) {
                e.preventDefault(); e.stopPropagation();
                const docId = downloadInvoiceBtn.dataset.id;
                if(docId) handleGenerateInvoice(docId, 'download', true);
                return;
            }

            if (deleteBoxBtn) {
                e.preventDefault(); e.stopPropagation();
                const docId = deleteBoxBtn.dataset.id;
                if(docId) handleDeleteBox(docId);
                return;
            }
            if (editBoxBtn) {
                 e.preventDefault(); e.stopPropagation();
                 const docId = editBoxBtn.dataset.id;
                 if(docId) handleEditBox(docId);
                 return;
            }

            if (backToShipmentsBtn) {
                e.preventDefault(); e.stopPropagation();
                loadContent('past-shipments');
                return;
            }
            
            // --- ME BLOCK EKA ALUTHIN ADD KALE ---
            if (editPastEntryBtn) {
                 e.preventDefault(); e.stopPropagation();
                 const shipmentId = editPastEntryBtn.dataset.shipmentId;
                 const entryIndex = editPastEntryBtn.dataset.entryIndex;
                 
                 if (shipmentId && entryIndex !== undefined) {
                    handleEditPastEntry(shipmentId, entryIndex);
                 }
                 return;
            }
            // --- IWARAI ---

            if (viewEntryDetailsBtn) {
                 e.preventDefault(); e.stopPropagation();
                 const shipmentId = viewEntryDetailsBtn.dataset.shipmentId;
                 const entryIndex = viewEntryDetailsBtn.dataset.entryIndex;
                 
                 if (shipmentId && entryIndex !== undefined) {
                    customAlert('Loading...', 'Loading entry details...');
                    const alertModal = document.getElementById('custom-alert-modal');
                    try {
                        const docRef = doc(db, `artifacts/${appId}/public/data/shipments`, shipmentId);
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists()) {
                            const shipment = docSnap.data();
                            const entryData = shipment.entries[parseInt(entryIndex)];
                            if (entryData) {
                                populateDetailsModal(entryData);
                                const modal = document.getElementById('view-details-modal');
                                if (modal) {
                                     delete modal.dataset.currentDocId;
                                     modal.dataset.currentData = JSON.stringify(entryData);
                                     modal.classList.remove('hidden');
                                     modal.classList.add('flex');
                                }
                                if(alertModal) alertModal.style.display = 'none';
                            } else {
                                if(alertModal) alertModal.style.display = 'none';
                                customAlert('Error', 'Could not find entry data in shipment.');
                            }
                        } else {
                             if(alertModal) alertModal.style.display = 'none';
                             customAlert('Error', 'Shipment data not found.');
                        }
                    } catch (err) {
                        console.error("Error fetching entry from shipment:", err);
                        if(alertModal) alertModal.style.display = 'none';
                        customAlert('Error', 'Failed to load entry details.');
                    }
                 }
                 return;
            }

            if (viewShipmentDetailsBtn || shipmentDetailsTrigger) {
                e.preventDefault(); e.stopPropagation();
                const btn = viewShipmentDetailsBtn || shipmentDetailsTrigger;
                const docId = btn.dataset.id;
                if(docId) handleViewShipmentDetails(docId);
                return;
            }

            // --- MEKA ALUTHIN ADD KALE ---
            if (clearShipmentFilterBtn) {
                const nameFilter = document.getElementById('filter-shipment-shipperName');
                const boxNoFilter = document.getElementById('filter-shipment-boxNo');
                const statusFilter = document.getElementById('filter-shipment-paymentStatus');
                
                if (nameFilter) nameFilter.value = '';
                if (boxNoFilter) boxNoFilter.value = '';
                if (statusFilter) statusFilter.value = 'All';
                
                filterShipmentEntriesTable();
            }
            // --- IWARAI ---

             if (viewDetailsTrigger) {
                 const actionCell = target.closest('.action-cell');
                 const tableRow = target.closest('.box-table-row');

                 if (!actionCell && tableRow && tableRow.dataset.id) {
                      const docId = tableRow.dataset.id;
                      handleViewDetails(docId);
                      return;
                 }
            }

        });

        // --- ME EVENT LISTENERS DEKA ALUTHIN ADD KALE ---
        // Shipment details page eke filter walata
        mainContent.addEventListener('keyup', (e) => {
            if (e.target.id === 'filter-shipment-shipperName' || e.target.id === 'filter-shipment-boxNo') {
                filterShipmentEntriesTable();
            }
        });
        
        mainContent.addEventListener('change', (e) => {
            const target = e.target;
            
            const statusSelect = target.closest('.shipment-status-select');
            if (statusSelect) {
                e.preventDefault(); e.stopPropagation();
                const shipmentId = statusSelect.dataset.id;
                const newStatus = statusSelect.value;
                if (shipmentId && newStatus) {
                    updateShipmentStatus(shipmentId, newStatus);
                }
                return;
            }
            
            // Aluth filter ekata
             if (e.target.id === 'filter-shipment-paymentStatus') {
                // Note: Payment status filter eka weda karanna data naha, eth function eka call karamu
                filterShipmentEntriesTable();
            }
        });
        // --- IWARAI ---

    } else {
         console.error("CRITICAL: Main content element (#main-content) not found during initialization!");
    }

    try {
        console.log("Initializing Firebase...");
        const app = initializeApp(canvasFirebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        console.log('Firebase Initialized. Project ID:', canvasFirebaseConfig.projectId);

        onAuthStateChanged(auth, async (user) => {
            const userIdSpan = document.getElementById('user-id');

            if (user) {
                userId = user.uid;
                console.log('User signed in:', user.email || user.uid);
                if (userIdSpan) userIdSpan.innerText = user.email || user.uid;

                if (loginContainer) loginContainer.style.display = 'none';
                if (appContainer) appContainer.style.display = 'flex';

                await loadCbmPrices(); // <-- New function

                loadShippersForAutofill();

                loadContent('dashboard');

            } else {
                userId = null;
                console.log('User is signed out.');

                if (loginContainer) loginContainer.style.display = 'flex';
                if (appContainer) appContainer.style.display = 'none';
                if (userIdSpan) userIdSpan.innerText = 'Not Logged In';

                allShippersData = [];
                legacyCBMPrice = 0; // <-- New variable
            }
        });

    } catch (error) {
        console.error('CRITICAL Error initializing Firebase:', error);
        customAlert('Fatal Error', `Could not initialize Firebase: ${error.message}. Please check console.`);
        const userIdSpan = document.getElementById('user-id');
        if (userIdSpan) userIdSpan.innerText = 'Initialization Error';
        if (loginContainer) loginContainer.style.display = 'none';
        if (appContainer) appContainer.style.display = 'none';
        document.body.innerHTML = `<h1 style="color: red; text-align: center; margin-top: 50px;">Fatal Error: Could not initialize. Check console.</h1> ${error.message}`;
    }
});

// =================================================================
// === INCOME & EXPENSES PAGE FUNCTIONS ===
// =================================================================

let transactionsListener = null;

function loadIncomeExpensesPage() {
    console.log("Loading Income & Expenses page...");
    const monthFilter = document.getElementById('filter-month');
    if (monthFilter) {
        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        monthFilter.value = `${year}-${month}`;
    }

    document.getElementById('add-transaction-btn')?.addEventListener('click', openAddTransactionModal);
    document.getElementById('filter-month')?.addEventListener('change', applyFiltersAndRender);
    document.getElementById('filter-type')?.addEventListener('change', applyFiltersAndRender);
    document.getElementById('filter-date')?.addEventListener('change', applyFiltersAndRender);
    document.getElementById('filter-category')?.addEventListener('keyup', applyFiltersAndRender);
    document.getElementById('filter-clear-btn')?.addEventListener('click', () => {
        document.getElementById('filter-month').value = '';
        document.getElementById('filter-type').value = 'All';
        document.getElementById('filter-date').value = '';
        document.getElementById('filter-category').value = '';
        applyFiltersAndRender();
    });

    const tableBody = document.getElementById('transactions-table-body');
    if (tableBody) {
        tableBody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-transaction-btn');
            const editBtn = e.target.closest('.edit-transaction-btn');
            
            if (deleteBtn) {
                e.preventDefault(); e.stopPropagation();
                const docId = deleteBtn.dataset.id;
                if (docId) handleDeleteTransaction(docId);
            }
            if (editBtn) {
                e.preventDefault(); e.stopPropagation();
                const docId = editBtn.dataset.id;
                if (docId) handleEditTransaction(docId);
            }
        });
    }
    
    listenForTransactions();
}

function listenForTransactions() {
    if (transactionsListener) {
        console.log("Unsubscribing from old transactions listener.");
        transactionsListener(); 
    }
    
    if (!db) return;
    const transactionsRef = collection(db, `artifacts/${appId}/public/data/transactions`);
    const q = query(transactionsRef, orderBy("date", "desc"));

    console.log("Setting up new transactions listener...");
    transactionsListener = onSnapshot(q, (snapshot) => {
        allTransactionsData = [];
        snapshot.forEach(doc => {
            allTransactionsData.push({ id: doc.id, ...doc.data() });
        });
        console.log(`Loaded ${allTransactionsData.length} transactions.`);
        applyFiltersAndRender();
    }, (error) => {
        console.error("Error loading transactions: ", error);
        const tableBody = document.getElementById('transactions-table-body');
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="px-6 py-10 text-center text-red-400">Error loading data.</td></tr>`;
    });
}

function applyFiltersAndRender() {
    
    const isDashboard = document.getElementById('dashboard-total-income');
    const isIncomePage = document.getElementById('transactions-table-body');

    if (!isDashboard && !isIncomePage) {
        if (transactionsListener) {
            console.log("Neither Dashboard nor Income page active. Unsubscribing from listener.");
            transactionsListener();
            transactionsListener = null;
        }
        return;
    }

    const monthFilter = document.getElementById('filter-month')?.value;
    const typeFilter = document.getElementById('filter-type')?.value;
    const dateFilter = document.getElementById('filter-date')?.value;
    const categoryFilterInput = document.getElementById('filter-category');
    const categoryFilter = categoryFilterInput ? categoryFilterInput.value.toLowerCase() : '';


    if(isIncomePage) {
        let filteredData = allTransactionsData.filter(tx => {
            const txDate = tx.date?.toDate ? tx.date.toDate() : new Date();
            const txDateString = txDate.toISOString().split('T')[0]; 
            const txMonthString = txDateString.substring(0, 7); 
            
            if (dateFilter) {
                if (txDateString !== dateFilter) return false;
            } 
            else if (monthFilter) {
                if (txMonthString !== monthFilter) return false;
            }

            if (typeFilter && typeFilter !== 'All') {
                if (tx.type !== typeFilter) return false;
            }

            if (categoryFilter) {
                if (!tx.category?.toLowerCase().includes(categoryFilter)) return false;
            }

            return true;
        });

        renderTransactionsTable(filteredData);
        updateSummaryCards(allTransactionsData, monthFilter, dateFilter);
    }

    const dashboardProfitCard = document.getElementById('dashboard-total-income');
    if (dashboardProfitCard) {
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        
        let monthIncome = 0;
        let monthExpenses = 0;
        
        allTransactionsData.forEach(tx => {
            const txDate = tx.date?.toDate ? tx.date.toDate() : new Date();
            if (txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth) {
                if (tx.type === 'Income') {
                    monthIncome += tx.amount || 0;
                } else if (tx.type === 'Expense') {
                    monthExpenses += tx.amount || 0;
                }
            }
        });
        
        const monthProfit = monthIncome - monthExpenses;
        dashboardProfitCard.innerText = `€ ${monthProfit.toFixed(2)}`;
    }

    renderIncomeExpenseChart(allTransactionsData);
}

function renderTransactionsTable(data) {
    const tableBody = document.getElementById('transactions-table-body');
    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="px-6 py-10 text-center text-gray-400">No matching transactions found.</td></tr>`;
        return;
    }

    tableBody.innerHTML = '';
    data.forEach(tx => {
        const date = tx.date?.toDate ? tx.date.toDate().toLocaleDateString('si-LK') : 'N/A';
        const typeClass = tx.type === 'Income' ? 'text-green-400' : 'text-red-400';
        const amount = (tx.amount || 0).toFixed(2);
        
        const row = `
            <tr class="hover:bg-gray-700 transition-colors duration-150">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">${date}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${tx.description || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${tx.category || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${tx.paymentMethod || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold ${typeClass}">${tx.type || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm ${typeClass}">€ ${amount}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-right space-x-2">
                    <button data-id="${tx.id}" class="edit-transaction-btn text-blue-400 hover:text-blue-300 p-1 inline-block" title="Edit Transaction">
                        <i data-lucide="edit-2" class="w-4 h-4 pointer-events-none"></i>
                    </button>
                    <button data-id="${tx.id}" class="delete-transaction-btn text-red-500 hover:text-red-400 p-1 inline-block" title="Delete Transaction">
                        <i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i>
                    </button>
                </td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
    
    if (window.lucide) {
       try { lucide.createIcons(); } catch(e){ console.error("Lucide error:", e); }
    }
}

function updateSummaryCards(data, monthFilter, dateFilter) {
    let income = 0;
    let expenses = 0;
    let title = "Total"; 
    
    const today = new Date();
    let filterDate = today;

    if (dateFilter) {
        filterDate = new Date(dateFilter + "T00:00:00"); 
        title = `Total (${filterDate.toLocaleDateString('en-GB')})`;
    } else if (monthFilter) {
        const [year, month] = monthFilter.split('-');
        filterDate = new Date(year, parseInt(month) - 1, 1);
        title = `Total (${filterDate.toLocaleString('default', { month: 'long', year: 'numeric' })})`;
    } else {
        title = `Total (${today.toLocaleString('default', { month: 'long', year: 'numeric' })})`;
    }

    data.forEach(tx => {
        const txDate = tx.date?.toDate ? tx.date.toDate() : new Date();

        let match = false;
        if (dateFilter) {
             match = (txDate.toISOString().split('T')[0] === dateFilter);
        } else if (monthFilter) {
             match = (txDate.getFullYear() === filterDate.getFullYear() && txDate.getMonth() === filterDate.getMonth());
        } else {
             match = (txDate.getFullYear() === today.getFullYear() && txDate.getMonth() === today.getMonth());
        }

        if (match) {
            if (tx.type === 'Income') {
                income += tx.amount || 0;
            } else if (tx.type === 'Expense') {
                expenses += tx.amount || 0;
            }
        }
    });

    const profit = income - expenses;
    
    document.getElementById('summary-income').innerText = `€ ${income.toFixed(2)}`;
    document.getElementById('summary-expenses').innerText = `€ ${expenses.toFixed(2)}`;
    document.getElementById('summary-profit').innerText = `€ ${profit.toFixed(2)}`;
    
    document.getElementById('summary-month-title-1').innerText = `Total Income (${title.replace('Total (', '')}`;
    document.getElementById('summary-month-title-2').innerText = `Total Expenses (${title.replace('Total (', '')}`;
    document.getElementById('summary-month-title-3').innerText = `Profit (${title.replace('Total (', '')}`;
}

function renderIncomeExpenseChart(data) {
    const ctx = document.getElementById('income-expense-chart');
    if (!ctx) return;

    let monthlyIncome = Array(12).fill(0);
    let monthlyExpenses = Array(12).fill(0);
    const currentYear = new Date().getFullYear();

    data.forEach(tx => {
        const txDate = tx.date?.toDate ? tx.date.toDate() : null;
        if (txDate && txDate.getFullYear() === currentYear) {
            const monthIndex = txDate.getMonth(); 
            if (tx.type === 'Income') {
                monthlyIncome[monthIndex] += tx.amount || 0;
            } else if (tx.type === 'Expense') {
                monthlyExpenses[monthIndex] += tx.amount || 0;
            }
        }
    });

    const chartData = {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        datasets: [
            {
                label: 'Income',
                data: monthlyIncome,
                borderColor: '#22C55E', 
                backgroundColor: '#22C55E',
                tension: 0.1
            },
            {
                label: 'Expenses',
                data: monthlyExpenses,
                borderColor: '#EF4444', 
                backgroundColor: '#EF4444',
                tension: 0.1
            }
        ]
    };

    if (incomeExpenseChart) {
        incomeExpenseChart.destroy();
    }

    incomeExpenseChart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#9CA3AF' }, 
                    grid: { color: '#374151' } 
                },
                x: {
                    ticks: { color: '#9CA3AF' }, 
                    grid: { color: '#374151' } 
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#E5E7EB' } 
                }
            }
        }
    });
}

function openAddTransactionModal(isEditing = false, docData = null) {
    const modal = document.getElementById('add-transaction-modal');
    const form = document.getElementById('add-transaction-form');
    const title = document.querySelector('#add-transaction-modal h2');
    const submitBtn = document.getElementById('add-transaction-submit-btn');
    
    if (!modal || !form || !title || !submitBtn) return console.error("Add transaction modal elements not found");

    form.reset();
    document.getElementById('editTransactionId').value = '';
    document.getElementById('transaction-form-message').innerText = '';

    if (isEditing && docData) {
        title.innerText = "Edit Transaction";
        submitBtn.innerText = "Update Transaction";
        document.getElementById('editTransactionId').value = docData.id;
        
        form.transactionType.value = docData.type || 'Expense';
        form.transactionDate.value = docData.date?.toDate ? docData.date.toDate().toISOString().split('T')[0] : '';
        form.transactionDescription.value = docData.description || '';
        form.transactionCategory.value = docData.category || '';
        form.transactionAmount.value = docData.amount || '';
        form.transactionPaymentMethod.value = docData.paymentMethod || '';
    } else {
        title.innerText = "Add New Transaction";
        submitBtn.innerText = "Save Transaction";
        form.transactionDate.value = new Date().toISOString().split('T')[0];
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAddTransactionModal() {
    const modal = document.getElementById('add-transaction-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function handleAddTransaction(e) {
    e.preventDefault();
    if (!db) return customAlert('Error', 'Database not connected.');

    const form = e.target;
    const messageDiv = document.getElementById('transaction-form-message');
    const editDocId = document.getElementById('editTransactionId').value;

    const transactionData = {
        type: form.transactionType.value,
        date: Timestamp.fromDate(new Date(form.transactionDate.value)),
        description: form.transactionDescription.value.trim(),
        category: form.transactionCategory.value.trim(),
        amount: parseFloat(form.transactionAmount.value) || 0,
        paymentMethod: form.transactionPaymentMethod.value.trim(),
        addedBy: userId || 'unknown',
        lastUpdatedAt: Timestamp.fromDate(new Date())
    };

    if (!transactionData.date || !transactionData.description || !transactionData.category || transactionData.amount <= 0) {
        customAlert('Validation Error', 'Please fill in Date, Description, Category, and a valid Amount.');
        return;
    }

    try {
        if (editDocId) {
            const txDocRef = doc(db, `artifacts/${appId}/public/data/transactions`, editDocId);
            await setDoc(txDocRef, transactionData, { merge: true });
            messageDiv.innerText = "Transaction updated successfully!";
        } else {
            transactionData.addedAt = Timestamp.fromDate(new Date());
            await addDoc(collection(db, `artifacts/${appId}/public/data/transactions`), transactionData);
            messageDiv.innerText = "Transaction added successfully!";
        }
        
        messageDiv.className = 'mt-4 text-center text-green-400';
        setTimeout(() => {
            closeAddTransactionModal();
        }, 1500);

    } catch (error) {
        console.error("Error saving transaction: ", error);
        messageDiv.innerText = `Error: ${error.message}`;
        messageDiv.className = 'mt-4 text-center text-red-400';
    }
}

async function handleDeleteTransaction(docId) {
    if (!db) return customAlert('Error', 'Database not connected.');
    if (!confirm('Are you sure you want to delete this transaction? This cannot be undone.')) {
        return;
    }
    
    try {
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/transactions`, docId));
        customAlert('Success', 'Transaction deleted.');
    } catch (error) {
        console.error("Error deleting transaction: ", error);
        customAlert('Error', `Failed to delete: ${error.message}`);
    }
}

async function handleEditTransaction(docId) {
    if (!db) return;
    
    try {
        const txDocRef = doc(db, `artifacts/${appId}/public/data/transactions`, docId);
        const docSnap = await getDoc(txDocRef);
        if (docSnap.exists()) {
            openAddTransactionModal(true, { id: docSnap.id, ...docSnap.data() });
        } else {
            customAlert('Error', 'Transaction not found.');
        }
    } catch (error) {
        console.error("Error fetching transaction for edit: ", error);
        customAlert('Error', `Failed to load data: ${error.message}`);
    }
}

// --- ALUTH FUNCTION 1 ---
// Past Shipment eka athule entry ekak edit karanna modal eka open karana eka
async function handleEditPastEntry(shipmentId, entryIndex) {
    if (!db) return customAlert('Error', 'Database not connected.');
    
    customAlert('Loading...', 'Loading entry data for editing...');
    const alertModal = document.getElementById('custom-alert-modal');

    try {
        const docRef = doc(db, `artifacts/${appId}/public/data/shipments`, shipmentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const shipment = docSnap.data();
            const entryData = shipment.entries[parseInt(entryIndex)];
            
            if (entryData) {
                // Form eka populate karanava
                populateEditForm(entryData);
                
                // Modal eke hidden fields set karanava
                document.getElementById('editDocId').value = ''; // Parana ek aclear karanava
                document.getElementById('editShipmentId').value = shipmentId;
                document.getElementById('editShipmentIndex').value = entryIndex;
                
                // Modal eka open karanava
                openAddBoxModal(true);
                
                if(alertModal) alertModal.style.display = 'none';
            } else {
                if(alertModal) alertModal.style.display = 'none';
                customAlert('Error', 'Could not find entry data in shipment.');
            }
        } else {
             if(alertModal) alertModal.style.display = 'none';
             customAlert('Error', 'Shipment data not found.');
        }
    } catch (err) {
        console.error("Error fetching entry from shipment for edit:", err);
        if(alertModal) alertModal.style.display = 'none';
        customAlert('Error', 'Failed to load entry details for editing.');
    }
}

// --- ALUTH FUNCTION 2 ---
// Shipment Details page eke entries table eka filter karana eka
function filterShipmentEntriesTable() {
    const nameFilterInput = document.getElementById('filter-shipment-shipperName');
    const boxNoFilterInput = document.getElementById('filter-shipment-boxNo');
    const statusFilterInput = document.getElementById('filter-shipment-paymentStatus');

    const nameFilter = nameFilterInput ? nameFilterInput.value.toLowerCase() : '';
    const boxNoFilter = boxNoFilterInput ? boxNoFilterInput.value.toLowerCase() : '';
    const statusFilter = statusFilterInput ? statusFilterInput.value : 'All';

    const tableBody = document.getElementById('shipment-entries-table-body');
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll('.shipment-entry-row');
    let hasVisibleRows = false;

    for (const row of rows) {
        if (row.cells.length < 6) continue;

        const boxNoCell = row.cells[0];
        const shipperCell = row.cells[1];
        // Status eka ganna api data eka save karala naha table eke,
        // E nisa me filter eka danata weda karanne nehe.
        // Hadatai puluwan, eth danata mehema thiyam.
        
        // **Update:** Status eka nathi nisa, api eka ain karamu.
        
        const boxNo = boxNoCell.innerText.toLowerCase();
        const shipper = shipperCell.innerText.toLowerCase();
        
        const nameMatch = shipper.includes(nameFilter);
        const boxNoMatch = boxNo.includes(boxNoFilter);
        // const statusMatch = (statusFilter === 'All'); // Status danata filter karanne ne

        if (nameMatch && boxNoMatch) {
            row.style.display = '';
            hasVisibleRows = true;
        } else {
            row.style.display = 'none';
        }
    }

     let noResultsRow = tableBody.querySelector('.no-results-row');
     
     if (!hasVisibleRows) {
         if (!noResultsRow) {
             const tr = document.createElement('tr');
             tr.className = 'no-results-row';
             tr.innerHTML = `<td colspan="6" class="px-6 py-10 text-center text-gray-400">No matching entries found.</td>`;
             tableBody.appendChild(tr);
         } else {
             noResultsRow.style.display = '';
         }
     } else if (noResultsRow) {
         noResultsRow.style.display = 'none';
     }
}